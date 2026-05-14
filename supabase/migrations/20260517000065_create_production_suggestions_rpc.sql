-- 20260517000065_create_production_suggestions_rpc.sql
-- Session 13 / Phase 2.A — get_production_suggestions_v1 RPC.
--
-- Returns a list of finished products to (re-)produce based on past sales
-- velocity vs current stock. Filters :
--   - products.product_type = 'finished' (NB: V3 has only {finished, combo})
--   - product has at least one active recipe row (deleted_at IS NULL)
--   - avg_daily_sales > 0 over the lookback window (no demand → no suggestion)
--
-- Computation (sub-plan D-2A-10) :
--   avg_daily_sales    = SUM(order_items.quantity) / p_lookback_days
--   days_of_stock      = current_stock / avg_daily_sales
--   suggested_quantity = GREATEST(0, ROUND(avg_daily_sales * 3) - current_stock)
--   priority           = 'high' if days_of_stock < p_priority_high
--                        'medium' if days_of_stock < p_priority_medium
--                        else 'low'

CREATE OR REPLACE FUNCTION get_production_suggestions_v1(
  p_lookback_days   INT DEFAULT 7,
  p_priority_high   INT DEFAULT 3,
  p_priority_medium INT DEFAULT 7
) RETURNS TABLE (
  product_id          UUID,
  product_name        TEXT,
  product_sku         TEXT,
  avg_daily_sales     NUMERIC,
  current_stock       NUMERIC,
  days_of_stock       NUMERIC,
  suggested_quantity  NUMERIC,
  priority            TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_lookback_days IS NULL OR p_lookback_days < 1 THEN
    RAISE EXCEPTION 'lookback_days_must_be_positive' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
    WITH sales AS (
      SELECT oi.product_id,
             SUM(oi.quantity)::NUMERIC / p_lookback_days AS avg_daily
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= now() - (p_lookback_days * INTERVAL '1 day')
        AND COALESCE(oi.is_cancelled, false) = false
      GROUP BY oi.product_id
      HAVING SUM(oi.quantity) > 0
    ),
    eligible AS (
      SELECT DISTINCT p.id, p.name, p.sku, p.current_stock, s.avg_daily
      FROM products p
      JOIN sales s ON s.product_id = p.id
      WHERE p.product_type = 'finished'
        AND p.deleted_at IS NULL
        AND p.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM recipes r
          WHERE r.product_id = p.id
            AND r.is_active = TRUE
            AND r.deleted_at IS NULL
        )
    )
    SELECT
      e.id           AS product_id,
      e.name         AS product_name,
      e.sku          AS product_sku,
      e.avg_daily    AS avg_daily_sales,
      e.current_stock,
      CASE WHEN e.avg_daily > 0 THEN e.current_stock / e.avg_daily ELSE NULL END AS days_of_stock,
      GREATEST(0, ROUND(e.avg_daily * 3) - e.current_stock)::NUMERIC AS suggested_quantity,
      CASE
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_high THEN 'high'
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_medium THEN 'medium'
        ELSE 'low'
      END AS priority
    FROM eligible e
    WHERE GREATEST(0, ROUND(e.avg_daily * 3) - e.current_stock) > 0
    ORDER BY
      CASE
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_high THEN 0
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_medium THEN 1
        ELSE 2
      END,
      e.avg_daily DESC;
END $$;

GRANT EXECUTE ON FUNCTION get_production_suggestions_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION get_production_suggestions_v1 FROM anon;

COMMENT ON FUNCTION get_production_suggestions_v1 IS
  'Session 13 — Phase 2.A. Returns production suggestions based on sales '
  'velocity vs current stock. Filters to finished products with active '
  'recipes and demand > 0 over the lookback window. Gated by inventory.read.';
