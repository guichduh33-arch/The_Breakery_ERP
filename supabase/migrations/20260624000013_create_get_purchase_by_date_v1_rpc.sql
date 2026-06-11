-- 20260624000013_create_get_purchase_by_date_v1_rpc.sql
-- S40 — Purchase by date aggregation. Gate reports.inventory.read.
-- received_* = PO status='received'; pending_* = status IN ('pending','partial')
-- draft/cancelled excluded throughout.

CREATE OR REPLACE FUNCTION public.get_purchase_by_date_v1(
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
  v_start          DATE;
  v_end            DATE;
  v_summary        JSONB;
  v_by_day         JSONB;
  v_po_count       INT;
  v_total          NUMERIC(14,2);
  v_received_count INT;
  v_pending_count  INT;
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

  -- Summary aggregates across all valid POs
  SELECT
    COUNT(*)::INT,
    COALESCE(SUM(total_amount), 0)::NUMERIC(14,2),
    COUNT(*) FILTER (WHERE status = 'received')::INT,
    COUNT(*) FILTER (WHERE status IN ('pending','partial'))::INT
  INTO v_po_count, v_total, v_received_count, v_pending_count
  FROM purchase_orders
  WHERE status NOT IN ('draft', 'cancelled')
    AND deleted_at IS NULL
    AND order_date BETWEEN v_start AND v_end;

  v_summary := jsonb_build_object(
    'po_count',        v_po_count,
    'total',           v_total,
    'received_count',  v_received_count,
    'pending_count',   v_pending_count
  );

  -- Per-day breakdown — subquery groups by day, outer aggregates to JSONB array
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date',            d.order_date,
      'po_count',        d.po_count,
      'total',           d.total,
      'received_total',  d.received_total,
      'pending_total',   d.pending_total
    ) ORDER BY d.order_date
  ), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      order_date,
      COUNT(*)::INT                                                                      AS po_count,
      COALESCE(SUM(total_amount), 0)::NUMERIC(14,2)                                     AS total,
      COALESCE((SUM(total_amount) FILTER (WHERE status = 'received')), 0)::NUMERIC(14,2)  AS received_total,
      COALESCE((SUM(total_amount) FILTER (WHERE status IN ('pending','partial'))), 0)::NUMERIC(14,2) AS pending_total
    FROM purchase_orders
    WHERE status NOT IN ('draft', 'cancelled')
      AND deleted_at IS NULL
      AND order_date BETWEEN v_start AND v_end
    GROUP BY order_date
  ) d;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', v_start, 'end', v_end),
    'summary', v_summary,
    'by_day',  v_by_day
  );
END;
$$;

COMMENT ON FUNCTION public.get_purchase_by_date_v1(TEXT, TEXT) IS
  'S40 — purchase orders aggregated by order_date (excl. draft/cancelled). '
  'received_* for status=received; pending_* for status IN (pending,partial). Gate reports.inventory.read.';

REVOKE ALL ON FUNCTION public.get_purchase_by_date_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_purchase_by_date_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_by_date_v1(TEXT, TEXT) TO authenticated;
