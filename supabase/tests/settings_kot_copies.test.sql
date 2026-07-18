-- supabase/tests/settings_kot_copies.test.sql
-- Chantier KOT copies (migration 20260718000195) — business_config
-- kot_copies_{barista,kitchen,display} + branches set_setting_v4 + catégorie
-- 'printing' de get_settings_by_category_v3. Auth pattern: EMP000 (ADMIN)
-- porte settings.update + settings.read (mirror settings_kds.test.sql).
--
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK (ou API-from-file).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- Seed an ADMIN identity for the whole transaction.
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
    WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- 1: business_config carries the 3 new columns at default 1 (current behavior).
SELECT ok(
  (SELECT kot_copies_barista = 1 AND kot_copies_kitchen = 1 AND kot_copies_display = 1
   FROM business_config WHERE id = 1),
  'business_config kot_copies_* columns exist with default 1/1/1');

-- 2: the old RPC versions are gone (versioning monotone: dropped in _195).
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('set_setting_v3', 'get_settings_by_category_v2')),
  'set_setting_v3 and get_settings_by_category_v2 are dropped');

-- 3: 'printing' category exposes the 5 keys (2 legacy toggles + 3 copies).
SELECT is(
  (get_settings_by_category_v3('printing')->'settings') - 'pos_auto_print_receipt' - 'pos_auto_open_drawer',
  jsonb_build_object(
    'kot_copies_barista', 1,
    'kot_copies_kitchen', 1,
    'kot_copies_display', 1),
  'printing category returns the 3 kot_copies_* keys at default 1');

-- 4: happy path — 0 is a legal value (paper off for that station).
SELECT lives_ok(
  $$SELECT set_setting_v4('kot_copies_barista', '0'::jsonb, 'printing')$$,
  'set kot_copies_barista=0 succeeds (paper off)');

-- 5: happy path — upper bound 5.
SELECT lives_ok(
  $$SELECT set_setting_v4('kot_copies_kitchen', '5'::jsonb, 'printing')$$,
  'set kot_copies_kitchen=5 succeeds (upper bound)');

-- 6: negative -> rejected.
SELECT throws_ok(
  $$SELECT set_setting_v4('kot_copies_kitchen', '-1'::jsonb, 'printing')$$,
  '22023', NULL, 'kot_copies_kitchen=-1 rejected (out of [0,5])');

-- 7: above max -> rejected.
SELECT throws_ok(
  $$SELECT set_setting_v4('kot_copies_display', '6'::jsonb, 'printing')$$,
  '22023', NULL, 'kot_copies_display=6 rejected (out of [0,5])');

-- 8: non-integer -> rejected.
SELECT throws_ok(
  $$SELECT set_setting_v4('kot_copies_display', '1.5'::jsonb, 'printing')$$,
  '22023', NULL, 'kot_copies_display=1.5 rejected (not an integer)');

-- 9: non-number -> rejected.
SELECT throws_ok(
  $$SELECT set_setting_v4('kot_copies_barista', '"2"'::jsonb, 'printing')$$,
  '22023', NULL, 'kot_copies_barista="2" rejected (expects number)');

-- 10: round-trip — final state reflects the writes (0 / 5 / 2).
SELECT lives_ok(
  $$SELECT set_setting_v4('kot_copies_display', '2'::jsonb, 'printing')$$,
  'set kot_copies_display=2 succeeds');
SELECT is(
  (get_settings_by_category_v3('printing')->'settings') - 'pos_auto_print_receipt' - 'pos_auto_open_drawer',
  jsonb_build_object(
    'kot_copies_barista', 0,
    'kot_copies_kitchen', 5,
    'kot_copies_display', 2),
  'final printing settings reflect the round-trip (0/5/2)');

-- 11: audit row for kot_copies_kitchen=5 carries key/old/new/category via the
-- mutualized audit path (rows share now() in this tx — match by content).
DO $audit$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'kot_copies_kitchen'
     AND metadata->>'new' = '5'
   LIMIT 1;
  PERFORM set_config('breakery.t_audit_pass',
    (v_md IS NOT NULL
     AND v_md->>'category' = 'printing'
     AND v_md ? 'old')::TEXT, true);
END $audit$;
SELECT ok(current_setting('breakery.t_audit_pass')::BOOLEAN,
  'audit_logs setting.update row for kot_copies_kitchen has key/old/new/category');

SELECT * FROM finish();
ROLLBACK;
