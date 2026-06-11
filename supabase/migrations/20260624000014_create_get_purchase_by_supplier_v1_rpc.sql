-- 20260624000014_create_get_purchase_by_supplier_v1_rpc.sql
-- S40 — Purchase by supplier aggregation. Gate reports.inventory.read.
-- cancelled included in po_count/cancelled_count but excluded from total (per spec).
-- avg_lead_days = ROUND(AVG(received_date - order_date), 1) on received POs only.
-- share_pct pattern from get_payments_by_method_v1 (S30).
-- draft excluded everywhere.

CREATE OR REPLACE FUNCTION public.get_purchase_by_supplier_v1(
  p_date_start TEXT,
  p_date_end   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start       DATE;
  v_end         DATE;
  v_by_supplier JSONB;
  v_global_total NUMERIC(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  -- Compute global total (non-cancelled, non-draft) for share_pct denominator
  SELECT COALESCE(SUM(po.total_amount), 0)
  INTO v_global_total
  FROM purchase_orders po
  WHERE po.status NOT IN ('draft', 'cancelled')
    AND po.deleted_at IS NULL
    AND po.order_date BETWEEN v_start AND v_end;

  WITH agg AS (
    SELECT
      s.id                                                              AS supplier_id,
      s.name                                                            AS supplier_name,
      COUNT(*)::INT                                                     AS po_count,
      SUM(po.total_amount) FILTER (WHERE po.status NOT IN ('draft','cancelled'))::NUMERIC(14,2)
                                                                        AS total,
      SUM(1) FILTER (WHERE po.status = 'received')::INT                AS received_count,
      SUM(1) FILTER (WHERE po.status = 'cancelled')::INT               AS cancelled_count,
      ROUND(
        AVG(
          EXTRACT(DAY FROM (po.received_date::timestamptz - po.order_date::timestamptz))
        ) FILTER (WHERE po.status = 'received' AND po.received_date IS NOT NULL),
        1
      )                                                                 AS avg_lead_days
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status != 'draft'
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_start AND v_end
    GROUP BY s.id, s.name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'supplier_id',       supplier_id,
      'supplier_name',     supplier_name,
      'po_count',          po_count,
      'total',             COALESCE(total, 0),
      'received_count',    COALESCE(received_count, 0),
      'cancelled_count',   COALESCE(cancelled_count, 0),
      'avg_lead_days',     avg_lead_days,
      'share_pct',         CASE WHEN v_global_total = 0 THEN 0
                                ELSE ROUND((COALESCE(total, 0) / v_global_total) * 100, 2)
                           END
    ) ORDER BY COALESCE(total, 0) DESC
  ), '[]'::jsonb)
  INTO v_by_supplier
  FROM agg;

  RETURN jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'by_supplier',  v_by_supplier
  );
END;
$$;

COMMENT ON FUNCTION public.get_purchase_by_supplier_v1(TEXT, TEXT) IS
  'S40 — purchase orders aggregated by supplier. cancelled included in po_count/cancelled_count '
  'but excluded from total and share_pct. avg_lead_days on received POs only. Gate reports.inventory.read.';

REVOKE ALL ON FUNCTION public.get_purchase_by_supplier_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_purchase_by_supplier_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_by_supplier_v1(TEXT, TEXT) TO authenticated;
