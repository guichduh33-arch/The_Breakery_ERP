-- 20260624000012_create_get_purchase_items_v1_rpc.sql
-- S40 — Purchase Items flat lines report. Gate reports.inventory.read.
-- JOINs verified from 20260517000110_init_purchase_orders.sql:
--   purchase_order_items.po_id → purchase_orders.id
--   purchase_orders.supplier_id → suppliers.id
--   purchase_order_items.product_id → products.id
-- purchase_orders.status CHECK: ('draft','pending','partial','received','cancelled')
-- purchase_order_items.subtotal is a GENERATED column (quantity * unit_cost).

CREATE OR REPLACE FUNCTION public.get_purchase_items_v1(
  p_date_start  TEXT,
  p_date_end    TEXT,
  p_supplier_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start      DATE;
  v_end        DATE;
  v_lines      JSONB;
  v_summary    JSONB;
  v_truncated  BOOLEAN := false;
  v_row_count  INT;
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

  -- Fetch LIMIT 1001 to detect truncation
  WITH raw_lines AS (
    SELECT
      po.id                           AS po_id,
      po.po_number                    AS po_number,
      po.order_date                   AS order_date,
      s.name                          AS supplier_name,
      p.id                            AS product_id,
      p.name                          AS product_name,
      p.sku                           AS sku,
      poi.quantity                    AS quantity,
      poi.received_quantity           AS received_quantity,
      poi.unit_cost                   AS unit_cost,
      poi.subtotal                    AS subtotal,
      po.status                       AS status
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    JOIN suppliers s ON s.id = po.supplier_id
    JOIN products p ON p.id = poi.product_id
    WHERE po.status NOT IN ('draft', 'cancelled')
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_start AND v_end
      AND (p_supplier_id IS NULL OR po.supplier_id = p_supplier_id)
    ORDER BY po.order_date DESC, po.po_number
    LIMIT 1001
  ),
  counted AS (
    SELECT *, ROW_NUMBER() OVER () AS rn FROM raw_lines
  )
  SELECT
    COUNT(*)::INT,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'po_id',              po_id,
        'po_number',          po_number,
        'order_date',         order_date,
        'supplier_name',      supplier_name,
        'product_id',         product_id,
        'product_name',       product_name,
        'sku',                sku,
        'quantity',           quantity,
        'received_quantity',  received_quantity,
        'unit_cost',          unit_cost,
        'subtotal',           subtotal,
        'status',             status
      )
    ) FILTER (WHERE rn <= 1000), '[]'::jsonb)
  INTO v_row_count, v_lines
  FROM counted;

  v_truncated := v_row_count > 1000;

  SELECT jsonb_build_object(
    'line_count',  LEAST(v_row_count, 1000),
    'total_value', COALESCE(
      (SELECT SUM((l->>'subtotal')::numeric) FROM jsonb_array_elements(v_lines) AS l),
      0
    )
  ) INTO v_summary;

  RETURN jsonb_build_object(
    'period',    jsonb_build_object('start', v_start, 'end', v_end),
    'summary',   v_summary,
    'lines',     v_lines,
    'truncated', v_truncated
  );
END;
$$;

COMMENT ON FUNCTION public.get_purchase_items_v1(TEXT, TEXT, UUID) IS
  'S40 — flat purchase order lines (excl. draft/cancelled). '
  'Optional p_supplier_id filter. LIMIT 1000 + truncated flag. Gate reports.inventory.read.';

REVOKE ALL ON FUNCTION public.get_purchase_items_v1(TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_purchase_items_v1(TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_items_v1(TEXT, TEXT, UUID) TO authenticated;
