-- 20260519000121_create_suggest_production_schedule_rpc.sql
-- Session 15 / Phase 4.B — Production schedule suggestion RPC.
--
-- suggest_production_schedule_v1(p_target_date DATE) returns a JSONB envelope
-- with suggestions for which recipes to plan on the target date, based on
-- past sales of the same day-of-week (DOW) within the last 4 weeks.
--
-- Decisions (Spec 2026-05-15 §D11) :
--   - Filter to same DOW within the last 28 days.
--   - Aggregate AVG daily qty sold per product (grouping by sale date), then
--     multiply by 1.10 for a 10% buffer.
--   - Only return products that have an active recipe (recipes.is_active=TRUE
--     AND deleted_at IS NULL).
--   - Fallback : if < 7 distinct sale days are observed for a product within
--     the window, suggested_qty = 0 and has_sufficient_history = false.
--   - Ranking : margin_pct * total_volume DESC.
--   - Gate : inventory.production.schedule. Raise 'forbidden' otherwise.
--
-- view_product_sales does not exist in the V3 schema as of 2026-05-16 ;
-- we aggregate directly from order_items joined with orders. Only orders in
-- a paid-equivalent state are counted ('paid','completed').

CREATE OR REPLACE FUNCTION suggest_production_schedule_v1(p_target_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_target_dow   INT  := EXTRACT(DOW FROM p_target_date)::int;
  v_window_start DATE := p_target_date - INTERVAL '28 days';
  v_suggestions  JSONB;
BEGIN
  -- Permission gate.
  IF NOT has_permission(v_uid, 'inventory.production.schedule') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = 'P0001',
            DETAIL  = 'inventory.production.schedule required';
  END IF;

  -- Aggregate same-DOW sales over the last 4 weeks.
  WITH same_dow_sales AS (
    SELECT
      oi.product_id,
      (o.created_at AT TIME ZONE 'UTC')::date AS sale_date,
      SUM(oi.quantity)                       AS qty_sold_that_day
    FROM order_items oi
    JOIN orders      o ON o.id = oi.order_id
    WHERE o.status IN ('paid','completed')
      AND o.created_at >= v_window_start
      AND o.created_at <  p_target_date + INTERVAL '1 day'
      AND EXTRACT(DOW FROM (o.created_at AT TIME ZONE 'UTC')::date) = v_target_dow
      AND COALESCE(oi.is_cancelled, FALSE) = FALSE
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id, (o.created_at AT TIME ZONE 'UTC')::date
  ),
  daily_avg AS (
    SELECT
      product_id,
      COUNT(DISTINCT sale_date)            AS sale_days,
      AVG(qty_sold_that_day)::numeric(10,3) AS avg_daily_qty,
      SUM(qty_sold_that_day)::numeric(10,3) AS total_volume
    FROM same_dow_sales
    GROUP BY product_id
  ),
  recipe_products AS (
    SELECT DISTINCT product_id
    FROM recipes
    WHERE is_active = TRUE AND deleted_at IS NULL
  ),
  enriched AS (
    SELECT
      p.id                AS product_id,
      p.name              AS product_name,
      da.sale_days,
      COALESCE(da.avg_daily_qty, 0)::numeric(10,3)   AS avg_daily_qty,
      COALESCE(da.total_volume, 0)::numeric(10,3)    AS total_volume,
      p.retail_price                                  AS retail_price,
      COALESCE(p.cost_price, 0)::numeric(10,3)       AS cost_price,
      CASE
        WHEN p.retail_price > 0
          THEN ((p.retail_price - COALESCE(p.cost_price, 0)) / p.retail_price * 100)::numeric(6,2)
        ELSE 0
      END                 AS margin_pct
    FROM products p
    JOIN recipe_products rp ON rp.product_id = p.id
    LEFT JOIN daily_avg  da ON da.product_id = p.id
    WHERE p.deleted_at IS NULL AND p.is_active = TRUE
  ),
  ranked AS (
    SELECT
      product_id,
      product_name,
      sale_days,
      avg_daily_qty,
      margin_pct,
      total_volume,
      (margin_pct * total_volume)::numeric(12,2)                AS ranking_score,
      (COALESCE(sale_days, 0) >= 7)                              AS has_sufficient_history,
      CASE
        WHEN COALESCE(sale_days, 0) >= 7
          THEN ROUND(avg_daily_qty * 1.10, 3)
        ELSE 0
      END                                                        AS suggested_qty
    FROM enriched
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'product_id',             product_id,
             'product_name',           product_name,
             'suggested_qty',          suggested_qty,
             'avg_daily_sales',        avg_daily_qty,
             'margin_pct',             margin_pct,
             'ranking_score',          ranking_score,
             'has_sufficient_history', has_sufficient_history,
             'sale_days',              COALESCE(sale_days, 0)
           )
           ORDER BY ranking_score DESC, product_name ASC
         ), '[]'::jsonb)
    INTO v_suggestions
    FROM ranked;

  RETURN jsonb_build_object(
    'target_date', p_target_date,
    'target_dow',  v_target_dow,
    'window_start', v_window_start,
    'suggestions', v_suggestions
  );
END $$;

REVOKE ALL ON FUNCTION suggest_production_schedule_v1(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION suggest_production_schedule_v1(DATE) TO authenticated;

COMMENT ON FUNCTION suggest_production_schedule_v1(DATE) IS
  'Session 15 / Phase 4.B — Suggest recipes to plan for a target date by '
  'aggregating same-DOW sales over the last 4 weeks, applying a 10% buffer, '
  'and ranking by margin x total volume DESC. Falls back to suggested_qty=0 '
  'when a product has < 7 distinct sale days of history in the window. '
  'Gated by inventory.production.schedule (Decision D11).';
