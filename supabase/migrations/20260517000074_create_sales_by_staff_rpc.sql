-- 20260517000074_create_sales_by_staff_rpc.sql
-- Session 13 / Phase 2.B / migration 5 :
--   RPC `get_sales_by_staff_v1(p_date_start, p_date_end)` returns per-staff
--   revenue, order count, and average basket over the requested date range.
--
-- "Staff" = `orders.served_by` → `user_profiles.id`. There is no dedicated
-- `staff` table in V3 ; we report on the cashier/waiter who closed the order.
--
-- Excludes : voided orders. Includes soft-deleted profiles for historical
-- accuracy (a staff member might leave after their last shift).
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md §1.E

CREATE OR REPLACE FUNCTION public.get_sales_by_staff_v1(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS TABLE (
  staff_id     UUID,
  staff_name   TEXT,
  total        DECIMAL(14,2),
  order_count  INT,
  avg_basket   DECIMAL(14,2)
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
    o.served_by                            AS staff_id,
    up.full_name                           AS staff_name,
    SUM(o.total)::DECIMAL(14,2)            AS total,
    COUNT(*)::INT                          AS order_count,
    (SUM(o.total) / NULLIF(COUNT(*), 0))::DECIMAL(14,2) AS avg_basket
  FROM orders o
  JOIN user_profiles up ON up.id = o.served_by
  WHERE o.status = 'paid'
    AND o.paid_at IS NOT NULL
    AND o.voided_at IS NULL
    AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY o.served_by, up.full_name
  ORDER BY total DESC;
$$;

COMMENT ON FUNCTION public.get_sales_by_staff_v1(DATE, DATE) IS
  'Phase 2.B — Sales-by-staff report. Joins orders.served_by to user_profiles '
  '(no dedicated staff table in V3). Voided orders excluded. Bucketed in '
  'business_config.timezone.';

GRANT EXECUTE ON FUNCTION public.get_sales_by_staff_v1(DATE, DATE) TO authenticated;
