-- 20260522000010_create_recipe_cost_history_v1_rpc.sql
-- Session 18 / Phase 1.A — Recipe cost history report RPC.
--
-- Dual-mode (D1) :
--   p_product_id IS NULL     → overview (1 row per product with history)
--   p_product_id IS NOT NULL → drill-down (1 row per version in window)
--
-- Reads recipe_versions + products. Ignores legacy bare-array snapshots
-- (snapshot ? 'items' = false) per D4.
-- Gated by financial.read (D2) — same as ProfitLoss/BalanceSheet/CashFlow.

CREATE OR REPLACE FUNCTION recipe_cost_history_v1(
  p_from       DATE,
  p_to         DATE,
  p_product_id UUID DEFAULT NULL
) RETURNS TABLE(
  product_id        UUID,
  product_name      TEXT,
  version_number    INT,
  created_at        TIMESTAMPTZ,
  cost_per_unit     NUMERIC,
  change_note       TEXT,
  baseline_cost     NUMERIC,
  delta_pct         NUMERIC,
  change_count      INT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'reports.financial.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'date_range_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  IF p_product_id IS NOT NULL THEN
    -- Drill-down mode.
    RETURN QUERY
    SELECT
      rv.product_id,
      p.name                                                AS product_name,
      rv.version_number,
      rv.created_at,
      (rv.snapshot->>'product_cost_at_version')::NUMERIC    AS cost_per_unit,
      rv.change_note,
      NULL::NUMERIC                                         AS baseline_cost,
      NULL::NUMERIC                                         AS delta_pct,
      NULL::INT                                             AS change_count
    FROM recipe_versions rv
    JOIN products p ON p.id = rv.product_id
    WHERE rv.product_id = p_product_id
      AND rv.snapshot ? 'items'
      AND rv.created_at::DATE BETWEEN p_from AND p_to
    ORDER BY rv.version_number ASC;
  ELSE
    -- Overview mode.
    RETURN QUERY
    WITH products_with_history AS (
      SELECT DISTINCT rv.product_id
        FROM recipe_versions rv
       WHERE rv.snapshot ? 'items'
    ),
    baseline AS (
      SELECT pwh.product_id,
             (
               SELECT (rv.snapshot->>'product_cost_at_version')::NUMERIC
                 FROM recipe_versions rv
                WHERE rv.product_id = pwh.product_id
                  AND rv.snapshot ? 'items'
                  AND rv.created_at::DATE <= p_from
                ORDER BY rv.created_at DESC, rv.version_number DESC
                LIMIT 1
             ) AS cost
        FROM products_with_history pwh
    ),
    current_cost AS (
      SELECT pwh.product_id,
             (
               SELECT (rv.snapshot->>'product_cost_at_version')::NUMERIC
                 FROM recipe_versions rv
                WHERE rv.product_id = pwh.product_id
                  AND rv.snapshot ? 'items'
                  AND rv.created_at::DATE <= p_to
                ORDER BY rv.created_at DESC, rv.version_number DESC
                LIMIT 1
             ) AS cost
        FROM products_with_history pwh
    ),
    window_stats AS (
      SELECT rv.product_id,
             COUNT(*)::INT      AS cnt,
             MAX(rv.created_at) AS last_change
        FROM recipe_versions rv
       WHERE rv.snapshot ? 'items'
         AND rv.created_at::DATE BETWEEN p_from AND p_to
       GROUP BY rv.product_id
    )
    SELECT
      pwh.product_id,
      p.name                                                  AS product_name,
      NULL::INT                                               AS version_number,
      ws.last_change                                          AS created_at,
      cc.cost                                                 AS cost_per_unit,
      NULL::TEXT                                              AS change_note,
      b.cost                                                  AS baseline_cost,
      CASE
        WHEN b.cost IS NULL OR b.cost = 0 THEN NULL
        ELSE round(((cc.cost - b.cost) / b.cost) * 100, 2)
      END                                                     AS delta_pct,
      COALESCE(ws.cnt, 0)                                     AS change_count
    FROM products_with_history pwh
    JOIN products p ON p.id = pwh.product_id
    LEFT JOIN baseline b      ON b.product_id = pwh.product_id
    LEFT JOIN current_cost cc ON cc.product_id = pwh.product_id
    LEFT JOIN window_stats ws ON ws.product_id = pwh.product_id
    WHERE ws.cnt IS NOT NULL OR b.cost IS NOT NULL
    ORDER BY p.name;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION recipe_cost_history_v1(DATE, DATE, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION recipe_cost_history_v1(DATE, DATE, UUID) FROM anon;

COMMENT ON FUNCTION recipe_cost_history_v1(DATE, DATE, UUID) IS
  'Session 18 / Phase 1.A. Recipe cost history report. Dual-mode : overview '
  '(p_product_id NULL) or drill-down (p_product_id set). Gated by financial.read. '
  'Ignores legacy bare-array snapshots.';
