-- 20260517000072_create_sales_by_hour_rpc.sql
-- Session 13 / Phase 2.B / migration 3 :
--   RPC `get_sales_by_hour_v1(p_date)` returns the 24-hour breakdown of paid
--   order revenue, bucketed in `business_config.timezone` (Asia/Makassar by
--   default).
--
-- The RPC always queries `orders` live (no MV) because hourly granularity is
-- too fine to materialize and the daily volume is small. Voided / cancelled
-- orders excluded ; modifier surcharges already included in orders.total.
--
-- Spec ref : docs/reference/04-modules/14-reports-analytics.md §22 (view_sales_by_hour)
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md §1.E

CREATE OR REPLACE FUNCTION public.get_sales_by_hour_v1(
  p_date DATE
)
RETURNS TABLE (
  hour         INT,
  total        DECIMAL(14,2),
  order_count  INT
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
  bucketed AS (
    SELECT
      EXTRACT(HOUR FROM (o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::INT AS hour,
      o.total
    FROM orders o
    WHERE o.status = 'paid'
      AND o.paid_at IS NOT NULL
      AND o.voided_at IS NULL
      AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date = p_date
  ),
  rolled AS (
    SELECT hour,
           SUM(total)::DECIMAL(14,2) AS total,
           COUNT(*)::INT             AS order_count
      FROM bucketed
     GROUP BY hour
  ),
  hours AS (SELECT generate_series(0, 23) AS hour)
  SELECT
    hours.hour,
    COALESCE(rolled.total,       0::DECIMAL(14,2)) AS total,
    COALESCE(rolled.order_count, 0)                AS order_count
  FROM hours
  LEFT JOIN rolled USING (hour)
  ORDER BY hours.hour;
$$;

COMMENT ON FUNCTION public.get_sales_by_hour_v1(DATE) IS
  'Phase 2.B — Sales-by-hour report. Always returns 24 rows (0..23), zero-filled '
  'for hours with no orders. Bucketed in business_config.timezone.';

GRANT EXECUTE ON FUNCTION public.get_sales_by_hour_v1(DATE) TO authenticated;
