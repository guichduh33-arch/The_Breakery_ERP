-- supabase/tests/settings_kds.test.sql
-- S75 Lot 2 (Task 5, migration 20260712000163) — business_config KDS
-- threshold columns + 'kds' settings category on get_settings_by_category_v1
-- / set_setting_v1. Auth pattern mirrors floor_plan_crud.test.sql: EMP000
-- (ADMIN) carries settings.update + settings.read (comment on
-- set_setting_v1: "ADMIN+ via settings.update").
--
-- Adaptation vs the task brief's pseudo-SQL (DEV-S57-02 — the LIVE body is
-- authority, not the brief): the live set_setting_v1 convention raises
-- ERRCODE 22023 ('setting_type_invalid' / 'setting_value_invalid' /
-- 'setting_unknown'), never P0001 — every throws_ok below asserts 22023,
-- not the brief's P0001.
--
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(13);

-- Seed an ADMIN identity for the whole transaction.
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
    WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- 1: business_config carries the 3 new columns at their documented defaults.
SELECT ok(
  (SELECT kds_warning_threshold_minutes = 5
      AND kds_urgent_threshold_minutes  = 10
      AND kds_auto_archive_minutes      = 5
   FROM business_config WHERE id = 1),
  'business_config kds_* columns exist with defaults 5/10/5');

-- 2: category 'kds' exposes all 3 keys at the defaults.
SELECT is(
  (get_settings_by_category_v1('kds')->'settings'),
  jsonb_build_object(
    'kds_warning_threshold_minutes', 5,
    'kds_urgent_threshold_minutes',  10,
    'kds_auto_archive_minutes',      5),
  'kds category returns the 3 threshold keys at defaults');

-- 3: happy path — set warning=3 (< urgent default 10).
SELECT lives_ok(
  $$SELECT set_setting_v1('kds_warning_threshold_minutes', '3'::jsonb, 'kds')$$,
  'set warning=3 (< urgent 10) succeeds');

-- 4: warning=0 out of range [1,120] -> rejected.
SELECT throws_ok(
  $$SELECT set_setting_v1('kds_warning_threshold_minutes', '0'::jsonb, 'kds')$$,
  '22023', NULL, 'warning=0 rejected (out of [1,120])');

-- 5: warning=200 out of range [1,120] -> rejected.
SELECT throws_ok(
  $$SELECT set_setting_v1('kds_warning_threshold_minutes', '200'::jsonb, 'kds')$$,
  '22023', NULL, 'warning=200 rejected (out of [1,120])');

-- 6: warning=10 (>= urgent 10) -> rejected (warning must stay < urgent).
SELECT throws_ok(
  $$SELECT set_setting_v1('kds_warning_threshold_minutes', '10'::jsonb, 'kds')$$,
  '22023', NULL, 'warning=10 rejected (>= urgent 10)');

-- 7: urgent=3 (<= current warning 3) -> rejected (urgent must stay > warning).
SELECT throws_ok(
  $$SELECT set_setting_v1('kds_urgent_threshold_minutes', '3'::jsonb, 'kds')$$,
  '22023', NULL, 'urgent=3 rejected (<= warning 3)');

-- 8: cross-order convergence — set urgent=15 first, then warning=12; both
-- succeed because each branch re-validates against the OTHER key's current
-- stored value regardless of which one is mutated first.
SELECT lives_ok(
  $$SELECT set_setting_v1('kds_urgent_threshold_minutes', '15'::jsonb, 'kds')$$,
  'set urgent=15 succeeds (urgent-first ordering)');
SELECT lives_ok(
  $$SELECT set_setting_v1('kds_warning_threshold_minutes', '12'::jsonb, 'kds')$$,
  'set warning=12 succeeds after urgent=15 (12 < 15)');

-- 9: auto-archive round-trip.
SELECT lives_ok(
  $$SELECT set_setting_v1('kds_auto_archive_minutes', '30'::jsonb, 'kds')$$,
  'set auto_archive=30 succeeds');

-- 10: final state matches the converged values (12 / 15 / 30) + audit row
-- for the warning key carries key/old/new via the mutualized audit path.
SELECT is(
  (get_settings_by_category_v1('kds')->'settings'),
  jsonb_build_object(
    'kds_warning_threshold_minutes', 12,
    'kds_urgent_threshold_minutes',  15,
    'kds_auto_archive_minutes',      30),
  'final kds settings reflect the converged round-trip (12/15/30)');

-- NOTE: every set_setting_v1 call above shares this transaction's now(), so
-- audit rows are NOT orderable by created_at here — match the warning=12 row
-- by its content instead of "latest".
DO $audit$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'kds_warning_threshold_minutes'
     AND metadata->>'new' = '12'
   LIMIT 1;
  PERFORM set_config('breakery.t_audit_pass',
    (v_md IS NOT NULL
     AND v_md->>'category' = 'kds'
     AND v_md ? 'old')::TEXT, true);
END $audit$;
SELECT ok(current_setting('breakery.t_audit_pass')::BOOLEAN,
  'audit_logs setting.update row for kds_warning_threshold_minutes has key/old/new/category');

-- 11: unknown key rejected with setting_unknown (22023), not silently ignored.
SELECT throws_ok(
  $$SELECT set_setting_v1('kds_bogus', '5'::jsonb, 'kds')$$,
  '22023', NULL, 'unknown key kds_bogus rejected (setting_unknown)');

SELECT * FROM finish();
ROLLBACK;
