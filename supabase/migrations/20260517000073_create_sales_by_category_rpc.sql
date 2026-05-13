-- 20260517000073_create_sales_by_category_rpc.sql
-- Session 13 / Phase 2.B / migration 4 :
--   RPC `get_sales_by_category_v1(p_date_start, p_date_end)` returns
--   per-category revenue + quantity over the requested date range.
--
-- Excludes :
--   - voided orders (`orders.voided_at IS NOT NULL`)
--   - cancelled line items (`order_items.is_cancelled = true`)
--   - promo gifts (`is_promo_gift = true`) — these have line_total = 0 anyway
--     but excluded explicitly for clarity.
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md §1.E

CREATE OR REPLACE FUNCTION public.get_sales_by_category_v1(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS TABLE (
  category_id    UUID,
  category_name  TEXT,
  total          DECIMAL(14,2),
  qty            DECIMAL(12,3)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  )
  SELECT
    c.id                                   AS category_id,
    c.name                                 AS category_name,
    COALESCE(SUM(oi.line_total), 0)::DECIMAL(14,2) AS total,
    COALESCE(SUM(oi.quantity),  0)::DECIMAL(12,3)  AS qty
  FROM order_items oi
  JOIN orders     o ON o.id = oi.order_id
  JOIN products   p ON p.id = oi.product_id
  JOIN categories c ON c.id = p.category_id
  WHERE o.status = 'paid'
    AND o.paid_at IS NOT NULL
    AND o.voided_at IS NULL
    AND oi.is_cancelled = false
    AND oi.is_promo_gift = false
    AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY c.id, c.name
  ORDER BY total DESC;
$$;

COMMENT ON FUNCTION public.get_sales_by_category_v1(DATE, DATE) IS
  'Phase 2.B — Sales-by-category report. Aggregates order_items.line_total + '
  'quantity per category over the date range, bucketed in business_config.timezone. '
  'Voided orders, cancelled lines, and promo gifts excluded.';

GRANT EXECUTE ON FUNCTION public.get_sales_by_category_v1(DATE, DATE) TO authenticated;
