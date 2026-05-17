-- 20260523000011_schedule_rl_purge_cron.sql
-- Session 19 / Phase 1.A — Daily purge of expired rate-limit buckets.
--
-- Decision ref : D3 (19:05 UTC, +5 min after pgTAP nightly at 19:00).

DO $$
DECLARE
  v_existing INT;
BEGIN
  -- Idempotent : drop a prior schedule with the same name if present.
  SELECT COUNT(*) INTO v_existing FROM cron.job WHERE jobname = 'rl-purge';
  IF v_existing > 0 THEN
    PERFORM cron.unschedule('rl-purge');
  END IF;

  PERFORM cron.schedule(
    'rl-purge',
    '5 19 * * *',
    $cron$DELETE FROM edge_function_rate_limits WHERE window_end < now() - interval '1 hour'$cron$
  );
END $$;

COMMENT ON EXTENSION pg_cron IS 'Used by Session 19 rl-purge job (+ pre-existing jobs if any).';
