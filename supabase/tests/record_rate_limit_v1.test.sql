-- supabase/tests/record_rate_limit_v1.test.sql
-- Session 19 / Phase 1.A — pgTAP coverage for record_rate_limit_v1.
--
-- Run via mcp__plugin_supabase_supabase__execute_sql (cloud V3 dev).
-- BEGIN/ROLLBACK envelope ensures no rows persist after the run.
--
-- Role strategy : cron.* schema is owned by `postgres` ; service_role lacks
-- USAGE. Test 8 (cron job introspection) runs under the default postgres
-- role ; tests 1-7 (RPC happy path + validation) run under service_role
-- to exercise the GRANT EXECUTE surface.

BEGIN;

-- Test plan : 8 tests
SELECT plan(8);

-- 8. Cron job 'rl-purge' is registered. (Runs first, under postgres, before role switch.)
SELECT is(
  (SELECT COUNT(*) FROM cron.job WHERE jobname = 'rl-purge')::INT,
  1,
  'rl-purge cron job registered'
);

-- Switch to service_role to exercise the GRANT EXECUTE surface.
SET LOCAL ROLE service_role;

-- 1. First call inserts and returns allowed=true, count=1.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60))::TEXT,
  'true',
  'First call → allowed=true'
);

-- 2. Second call within window bumps count to 2.
SELECT is(
  (SELECT current_count FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60)),
  2,
  'Second call → count=2'
);

-- 3. Third call still allowed.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60))::TEXT,
  'true',
  'Third call → still allowed (count=3 = max, but max is inclusive bound)'
);

-- 4. Fourth call (over max=3) rejected.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-1', '127.0.0.1', 3, 60))::TEXT,
  'false',
  'Fourth call → allowed=false (max exceeded)'
);

-- 5. Different bucket_key is isolated.
SELECT is(
  (SELECT allowed FROM record_rate_limit_v1('test-fn', 'tkey-2', '127.0.0.1', 3, 60))::TEXT,
  'true',
  'Different bucket_key → independent bucket'
);

-- 6. CHECK constraint : empty function_name raises P0001.
SELECT throws_ok(
  $$SELECT record_rate_limit_v1('', 'k', '1.2.3.4', 3, 60)$$,
  'P0001',
  'function_name_required',
  'Empty function_name → P0001'
);

-- 7. CHECK constraint : zero max_per_window raises P0001.
SELECT throws_ok(
  $$SELECT record_rate_limit_v1('fn', 'k', '1.2.3.4', 0, 60)$$,
  'P0001',
  'max_per_window_invalid',
  'Zero max → P0001'
);

-- Cleanup : delete our test rows.
DELETE FROM edge_function_rate_limits WHERE function_name = 'test-fn';

SELECT * FROM finish();
ROLLBACK;
