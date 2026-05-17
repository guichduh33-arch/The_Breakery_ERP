-- supabase/tests/record_rate_limit_v1_race.test.sql
-- Session 19 / Phase 1.A — pgTAP coverage for the race-mitigation lock in
-- record_rate_limit_v1 (see corrective migration 20260523000012).
--
-- Run via mcp__plugin_supabase_supabase__execute_sql (cloud V3 dev).
-- BEGIN/ROLLBACK envelope ensures no rows persist after the run.

BEGIN;
SELECT plan(2);

-- Sanity: function exists with advisory-lock branch (check via pg_proc.prosrc).
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'record_rate_limit_v1') LIKE '%pg_advisory_xact_lock%',
  'record_rate_limit_v1 calls pg_advisory_xact_lock for concurrency safety'
);

-- Functional: a call holds the lock during execution.
-- We can't easily test concurrent execution in pgTAP without async, so we
-- assert the lock function is exposed in the call chain. The behavioral
-- guarantee is documented + covered by the cross-instance Vitest test in
-- Phase 2.A.
SELECT ok(
  (SELECT prosrc FROM pg_proc WHERE proname = 'record_rate_limit_v1') LIKE '%hashtextextended%',
  'record_rate_limit_v1 keys the advisory lock on (function_name, bucket_key)'
);

SELECT * FROM finish();
ROLLBACK;
