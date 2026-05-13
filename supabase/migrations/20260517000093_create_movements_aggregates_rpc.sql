-- 20260517000093_create_movements_aggregates_rpc.sql
-- Session 13 / Phase 2.D — Movement aggregates by type within a window.
--
-- get_movement_aggregates_v1 returns a JSONB array of
--   { movement_type, count, qty_total, value_total }
-- groupings for movements that intersect the given section (from OR to) and
-- date window. Used to render the StockMovementsPage summary banner and the
-- ProductDashboard.

CREATE OR REPLACE FUNCTION get_movement_aggregates_v1(
  p_section_id  UUID         DEFAULT NULL,
  p_product_id  UUID         DEFAULT NULL,
  p_date_start  TIMESTAMPTZ  DEFAULT NULL,
  p_date_end    TIMESTAMPTZ  DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::JSONB) INTO v_result
  FROM (
    SELECT
      sm.movement_type::TEXT AS movement_type,
      COUNT(*)::BIGINT       AS count,
      SUM(ABS(sm.quantity))  AS qty_total,
      SUM(ABS(sm.quantity) * COALESCE(sm.unit_cost,
            (SELECT cost_price FROM products WHERE id = sm.product_id))) AS value_total
    FROM stock_movements sm
    WHERE (p_section_id IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
      AND (p_product_id IS NULL OR sm.product_id = p_product_id)
      AND (p_date_start IS NULL OR sm.created_at >= p_date_start)
      AND (p_date_end   IS NULL OR sm.created_at <= p_date_end)
    GROUP BY sm.movement_type
    ORDER BY sm.movement_type::TEXT
  ) t;

  RETURN v_result;
END $$;

REVOKE EXECUTE ON FUNCTION get_movement_aggregates_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_movement_aggregates_v1 TO authenticated;

COMMENT ON FUNCTION get_movement_aggregates_v1 IS
  'Session 13 — Phase 2.D. inventory.read. Returns {movement_type, count, qty_total, '
  'value_total} groupings for the filter window. value_total falls back to '
  'products.cost_price when stock_movements.unit_cost is NULL.';
