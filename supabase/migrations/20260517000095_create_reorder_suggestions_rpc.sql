-- 20260517000095_create_reorder_suggestions_rpc.sql
-- Session 13 / Phase 2.D — Reorder suggestions.
--
-- get_reorder_suggestions_v1 derives a "what to reorder, how much, from whom"
-- list from the stock_movements ledger. For each active product we compute :
--
--   avg_daily_usage = SUM(ABS(quantity)) / N
--                     for movement_type IN ('sale','production_out','waste','transfer_out')
--                     over the last N=p_lookback_days days.
--   days_of_stock   = current_stock / NULLIF(avg_daily_usage, 0).
--   suggested_qty   = MAX(0, avg_daily_usage * p_buffer_days - current_stock).
--   supplier        = most recent supplier_id seen on a purchase/incoming movement.
--
-- Filters in : days_of_stock < p_buffer_days OR current_stock < min_stock_threshold.
--
-- Defaults : p_lookback_days = 30, p_buffer_days = 14. Both are configurable
-- so the BO UI can let the user expand the horizon.

CREATE OR REPLACE FUNCTION get_reorder_suggestions_v1(
  p_lookback_days INT DEFAULT 30,
  p_buffer_days   INT DEFAULT 14
) RETURNS TABLE (
  product_id           UUID,
  product_sku          TEXT,
  product_name         TEXT,
  unit                 TEXT,
  current_stock        DECIMAL(10,3),
  min_stock_threshold  DECIMAL(10,3),
  avg_daily_usage      DECIMAL(10,3),
  days_of_stock        DECIMAL(10,3),
  suggested_order_qty  DECIMAL(10,3),
  supplier_id          UUID,
  supplier_name        TEXT,
  last_purchase_at     TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_lookback INT;
  v_buffer   INT;
  v_since    TIMESTAMPTZ;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_lookback := GREATEST(COALESCE(p_lookback_days, 30), 1);
  v_buffer   := GREATEST(COALESCE(p_buffer_days, 14), 1);
  v_since    := now() - (v_lookback * INTERVAL '1 day');

  RETURN QUERY
  WITH usage AS (
    SELECT
      sm.product_id,
      SUM(ABS(sm.quantity)) / v_lookback::DECIMAL AS avg_daily
    FROM stock_movements sm
    WHERE sm.created_at >= v_since
      AND sm.movement_type IN ('sale','production_out','waste','transfer_out')
    GROUP BY sm.product_id
  ), latest_supplier AS (
    SELECT DISTINCT ON (sm.product_id)
      sm.product_id, sm.supplier_id, sm.created_at
    FROM stock_movements sm
    WHERE sm.supplier_id IS NOT NULL
      AND sm.movement_type IN ('purchase','incoming')
    ORDER BY sm.product_id, sm.created_at DESC
  )
  SELECT
    p.id, p.sku, p.name, p.unit,
    p.current_stock,
    p.min_stock_threshold,
    COALESCE(u.avg_daily, 0)::DECIMAL(10,3),
    CASE
      WHEN COALESCE(u.avg_daily, 0) = 0 THEN NULL
      ELSE (p.current_stock / u.avg_daily)::DECIMAL(10,3)
    END,
    GREATEST(0, COALESCE(u.avg_daily, 0) * v_buffer - p.current_stock)::DECIMAL(10,3),
    ls.supplier_id,
    sup.name,
    ls.created_at
  FROM products p
  LEFT JOIN usage u ON u.product_id = p.id
  LEFT JOIN latest_supplier ls ON ls.product_id = p.id
  LEFT JOIN suppliers sup ON sup.id = ls.supplier_id
  WHERE p.deleted_at IS NULL
    AND p.is_active = true
    AND (
      (COALESCE(u.avg_daily, 0) > 0 AND (p.current_stock / u.avg_daily) < v_buffer)
      OR (p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold)
    )
  ORDER BY
    CASE WHEN COALESCE(u.avg_daily, 0) > 0
         THEN (p.current_stock / u.avg_daily)
         ELSE 0 END ASC,
    p.name;
END $$;

REVOKE EXECUTE ON FUNCTION get_reorder_suggestions_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_reorder_suggestions_v1 TO authenticated;

COMMENT ON FUNCTION get_reorder_suggestions_v1 IS
  'Session 13 — Phase 2.D. inventory.read. Computes per-product reorder suggestions '
  'from stock_movements over the last p_lookback_days. suggested_order_qty = MAX(0, '
  'avg_daily_usage * p_buffer_days - current_stock). Supplier hint comes from the '
  'most recent purchase/incoming movement.';
