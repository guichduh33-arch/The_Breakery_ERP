-- 20260517000213_create_basket_analysis_rpc.sql
-- Session 13 / Phase 6.A — Market-basket analysis RPC.
--
-- `get_basket_analysis_v1(p_date_start, p_date_end, p_top_n := 10)` —
-- finds pairs of products frequently purchased together in the same paid
-- order during a date window. Useful for cross-sell recommendations.
--
-- Algorithm:
--   1. Filter `orders` to paid, non-voided, in [p_date_start, p_date_end]
--      bucketed by business_config timezone.
--   2. Self-join `order_items` on order_id, force `product_id_a <
--      product_id_b` to deduplicate unordered pairs.
--   3. Count distinct orders containing each pair (co-occurrence) and
--      each individual product (support).
--   4. Compute support / confidence / lift :
--        support(A)         = orders_with_A / total_orders
--        support(A,B)       = orders_with_A_and_B / total_orders
--        confidence(A → B)  = orders_with_A_and_B / orders_with_A
--        lift(A,B)          = support(A,B) / (support(A) * support(B))
--   5. Return top-N pairs by lift (then by co-occurrence count).
--
-- Excludes:
--   - Voided orders, cancelled order_items, promo-gift items.
--   - Pairs where either product is now soft-deleted.
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-6.A-reports-cascade.md

CREATE OR REPLACE FUNCTION public.get_basket_analysis_v1(
  p_date_start DATE,
  p_date_end   DATE,
  p_top_n      INT DEFAULT 10
)
RETURNS TABLE (
  product_id_a        UUID,
  product_a_name      TEXT,
  product_id_b        UUID,
  product_b_name      TEXT,
  co_occurrence_count INT,
  support_a           DECIMAL(8,6),
  support_b           DECIMAL(8,6),
  support_pair        DECIMAL(8,6),
  confidence          DECIMAL(8,6),
  lift                DECIMAL(10,4)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  ),
  filtered_orders AS (
    SELECT o.id
    FROM orders o
    WHERE o.status = 'paid'
      AND o.paid_at IS NOT NULL
      AND o.voided_at IS NULL
      AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg))::date
            BETWEEN p_date_start AND p_date_end)
  ),
  total_orders AS (
    SELECT GREATEST(COUNT(*), 1)::DECIMAL AS n FROM filtered_orders
  ),
  order_products AS (
    -- distinct (order, product) — one order may have the same product twice
    SELECT DISTINCT
      oi.order_id,
      oi.product_id
    FROM order_items oi
    JOIN filtered_orders fo ON fo.id = oi.order_id
    WHERE oi.product_id IS NOT NULL
      AND oi.is_cancelled IS NOT TRUE
      AND oi.is_promo_gift IS NOT TRUE
  ),
  product_support AS (
    SELECT
      op.product_id,
      COUNT(DISTINCT op.order_id)::INT AS order_count
    FROM order_products op
    GROUP BY op.product_id
  ),
  pairs AS (
    SELECT
      a.product_id AS product_id_a,
      b.product_id AS product_id_b,
      COUNT(DISTINCT a.order_id)::INT AS co_count
    FROM order_products a
    JOIN order_products b
      ON a.order_id = b.order_id
     AND a.product_id < b.product_id
    GROUP BY a.product_id, b.product_id
  )
  SELECT
    p.product_id_a,
    pa.name AS product_a_name,
    p.product_id_b,
    pb.name AS product_b_name,
    p.co_count AS co_occurrence_count,
    (sa.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_a,
    (sb.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_b,
    (p.co_count    / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_pair,
    CASE
      WHEN sa.order_count = 0 THEN 0::DECIMAL(8,6)
      ELSE (p.co_count::DECIMAL / sa.order_count)::DECIMAL(8,6)
    END AS confidence,
    CASE
      WHEN sa.order_count = 0 OR sb.order_count = 0 THEN 0::DECIMAL(10,4)
      ELSE (
        (p.co_count::DECIMAL * (SELECT n FROM total_orders))
        / NULLIF(sa.order_count::DECIMAL * sb.order_count, 0)
      )::DECIMAL(10,4)
    END AS lift
  FROM pairs p
  JOIN product_support sa ON sa.product_id = p.product_id_a
  JOIN product_support sb ON sb.product_id = p.product_id_b
  JOIN products pa
    ON pa.id = p.product_id_a
   AND pa.deleted_at IS NULL
  JOIN products pb
    ON pb.id = p.product_id_b
   AND pb.deleted_at IS NULL
  ORDER BY lift DESC NULLS LAST, co_occurrence_count DESC
  LIMIT GREATEST(p_top_n, 1);
$$;

COMMENT ON FUNCTION public.get_basket_analysis_v1(DATE, DATE, INT) IS
  'Phase 6.A — Market-basket analysis. Returns top-N product pairs by '
  'lift over a paid-order window. Excludes voided/cancelled/promo-gift '
  'lines and soft-deleted products.';

GRANT EXECUTE ON FUNCTION public.get_basket_analysis_v1(DATE, DATE, INT) TO authenticated;
