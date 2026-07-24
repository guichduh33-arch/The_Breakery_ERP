-- supabase/tests/hub_lan_offline_settings.test.sql
-- Spec 006x lot 4 (migrations 20260721000197 + 20260721000198) —
-- business_config offline_cash_enabled / offline_max_hours, branches
-- set_setting_v5 + catégorie 'network' de get_settings_by_category_v7, et
-- pay_existing_order_v13 (p_offline_replay, arbitrage A4). Auth pattern :
-- EMP000 (ADMIN) porte settings.update + settings.read (mirror
-- settings_kot_copies.test.sql).
--
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK (ou API-from-file).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);

-- Seed an ADMIN identity for the whole transaction.
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
    WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- 1: colonnes présentes aux défauts spec (false / 4 h).
SELECT ok(
  (SELECT offline_cash_enabled = false AND offline_max_hours = 4
   FROM business_config WHERE id = 1),
  'business_config offline_* columns exist with defaults false/4');

-- 2: versioning monotone — v4/v3/v12 droppées dans _197/_198.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('set_setting_v4', 'get_settings_by_category_v3', 'pay_existing_order_v12')),
  'set_setting_v4, get_settings_by_category_v3 and pay_existing_order_v12 are dropped');

-- 3: la catégorie network expose exactement les 2 clés aux défauts.
SELECT is(
  get_settings_by_category_v7('network')->'settings',
  jsonb_build_object('offline_cash_enabled', false, 'offline_max_hours', 4),
  'network category returns the 2 offline keys at defaults');

-- 4: activation explicite du cash offline.
SELECT lives_ok(
  $$SELECT set_setting_v5('offline_cash_enabled', 'true'::jsonb, 'network')$$,
  'set offline_cash_enabled=true succeeds');

-- 5: fenêtre élargie légale.
SELECT lives_ok(
  $$SELECT set_setting_v5('offline_max_hours', '8'::jsonb, 'network')$$,
  'set offline_max_hours=8 succeeds');

-- 6: zéro -> rejeté (borne basse 1).
SELECT throws_ok(
  $$SELECT set_setting_v5('offline_max_hours', '0'::jsonb, 'network')$$,
  '22023', NULL, 'offline_max_hours=0 rejected (out of [1,24])');

-- 7: au-delà de 24 h -> rejeté.
SELECT throws_ok(
  $$SELECT set_setting_v5('offline_max_hours', '25'::jsonb, 'network')$$,
  '22023', NULL, 'offline_max_hours=25 rejected (out of [1,24])');

-- 8: non-entier -> rejeté.
SELECT throws_ok(
  $$SELECT set_setting_v5('offline_max_hours', '2.5'::jsonb, 'network')$$,
  '22023', NULL, 'offline_max_hours=2.5 rejected (not an integer)');

-- 9: mauvais type -> rejeté.
SELECT throws_ok(
  $$SELECT set_setting_v5('offline_cash_enabled', '"yes"'::jsonb, 'network')$$,
  '22023', NULL, 'offline_cash_enabled="yes" rejected (expects boolean)');

-- 10: round-trip — l'état final reflète les écritures (true / 8).
SELECT is(
  get_settings_by_category_v7('network')->'settings',
  jsonb_build_object('offline_cash_enabled', true, 'offline_max_hours', 8),
  'final network settings reflect the round-trip (true/8)');

-- 11: audit row (chemin mutualisé set_setting) avec key/old/new/category.
DO $audit$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'offline_max_hours'
     AND metadata->>'new' = '8'
   LIMIT 1;
  PERFORM set_config('breakery.t_audit_pass',
    (v_md IS NOT NULL
     AND v_md->>'category' = 'network'
     AND v_md ? 'old')::TEXT, true);
END $audit$;
SELECT ok(current_setting('breakery.t_audit_pass')::BOOLEAN,
  'audit_logs setting.update row for offline_max_hours has key/old/new/category');

-- 12: pay_existing_order_v13 porte p_offline_replay boolean (A4).
SELECT ok(
  (SELECT pg_get_function_identity_arguments(p.oid) LIKE '%p_offline_replay boolean%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_existing_order_v13'),
  'pay_existing_order_v13 signature carries p_offline_replay boolean');

-- 13: la branche A4 force allow_negative et trace offline_replay dans l'audit.
SELECT ok(
  (SELECT prosrc LIKE '%IF p_offline_replay THEN%'
      AND prosrc LIKE '%v_allow_negative := true%'
      AND prosrc LIKE '%''offline_replay'',  p_offline_replay%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_existing_order_v13'),
  'v13 body forces allow_negative under replay and stamps offline_replay in audit metadata');

-- 14: defense-in-depth — anon n'exécute AUCUNE des 3 nouvelles fonctions.
SELECT ok(
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('set_setting_v5', 'get_settings_by_category_v7', 'pay_existing_order_v13')),
  'anon has no EXECUTE on set_setting_v5 / get_settings_by_category_v7 / pay_existing_order_v13');

SELECT * FROM finish();
ROLLBACK;
