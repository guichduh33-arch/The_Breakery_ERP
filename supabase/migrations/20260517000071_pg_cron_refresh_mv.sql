-- 20260517000071_pg_cron_refresh_mv.sql
-- Session 13 / Phase 2.B / migration 2 :
--   Schedule refresh of the 3 materialised views via pg_cron.
--
-- Wrappers (`refresh_mv_*`) are SECURITY DEFINER so pg_cron (which runs as the
-- `postgres` superuser anyway) hits the right search_path. Refresh uses
-- CONCURRENTLY so the BO continues to read the stale snapshot during refresh.
--
-- Schedule :
--   refresh-mv-sales-daily    : hourly at minute 5
--   refresh-mv-stock-variance : every 15 minutes
--   refresh-mv-pl-monthly     : daily at 02:00 (local server time)
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md §1.D

-- ============================================================
-- Wrapper functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_mv_sales_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_sales_daily;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_mv_stock_variance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_stock_variance;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_mv_pl_monthly()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_pl_monthly;
END $$;

COMMENT ON FUNCTION public.refresh_mv_sales_daily()    IS 'Phase 2.B — wrapper for pg_cron, refreshes mv_sales_daily.';
COMMENT ON FUNCTION public.refresh_mv_stock_variance() IS 'Phase 2.B — wrapper for pg_cron, refreshes mv_stock_variance.';
COMMENT ON FUNCTION public.refresh_mv_pl_monthly()     IS 'Phase 2.B — wrapper for pg_cron, refreshes mv_pl_monthly.';

-- Restrict execute to postgres + service_role (cron runs as postgres) ; BO
-- never calls these directly — they read the MV.
REVOKE ALL ON FUNCTION public.refresh_mv_sales_daily()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_mv_stock_variance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_mv_pl_monthly()     FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_mv_sales_daily()    TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mv_stock_variance() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_mv_pl_monthly()     TO service_role;

-- ============================================================
-- pg_cron schedules — guarded by `cron.unschedule` for idempotency
-- ============================================================
DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  -- Drop any pre-existing jobs of the same name to make this migration
  -- idempotent (re-apply safe).
  FOR v_job_id IN
    SELECT jobid FROM cron.job
     WHERE jobname IN ('refresh-mv-sales-daily',
                       'refresh-mv-stock-variance',
                       'refresh-mv-pl-monthly')
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;
END $$;

SELECT cron.schedule(
  'refresh-mv-sales-daily',
  '5 * * * *',            -- :05 every hour
  $cmd$SELECT public.refresh_mv_sales_daily()$cmd$
);

SELECT cron.schedule(
  'refresh-mv-stock-variance',
  '*/15 * * * *',         -- every 15 minutes
  $cmd$SELECT public.refresh_mv_stock_variance()$cmd$
);

SELECT cron.schedule(
  'refresh-mv-pl-monthly',
  '0 2 * * *',            -- 02:00 every day
  $cmd$SELECT public.refresh_mv_pl_monthly()$cmd$
);
