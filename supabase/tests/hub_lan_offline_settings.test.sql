-- supabase/tests/hub_lan_offline_settings.test.sql
-- ADR-015 (migration 20260727000252) — encaissement hors-ligne LAN étendu à
-- tous les moyens de paiement sauf l'avoir :
--   * business_config.offline_payments_enabled (ex offline_cash_enabled) ;
--   * offline_max_hours SUPPRIMÉE (plus de fenêtre de blocage) ;
--   * set_setting_v13 / get_settings_by_category_v10 ;
--   * pay_existing_order_v17 : p_payments multi-règlements + p_offline_replay,
--     qui ne bypasse PAS le gate store_credit.
--
-- Remplace la suite spec 006x lot 4, devenue caduque (elle appelait
-- set_setting_v5, droppée depuis). Auth : EMP000 (ADMIN) porte
-- settings.update + settings.read.
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

-- 1: la colonne renommée existe, défaut false INCHANGÉ (activation explicite).
-- On lit le DÉFAUT du catalogue, pas la valeur vivante : le réglage est éditable
-- en production (BO LAN Devices) et sa valeur courante n'est pas un invariant.
SELECT is(
  (SELECT pg_get_expr(d.adbin, d.adrelid)
     FROM pg_attrdef d
     JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.business_config'::regclass
      AND a.attname = 'offline_payments_enabled'),
  'false',
  'business_config.offline_payments_enabled exists, defaults to false');

-- 2: les deux anciennes colonnes ont disparu.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'business_config'
                AND column_name IN ('offline_cash_enabled', 'offline_max_hours')),
  'offline_cash_enabled and offline_max_hours columns are gone');

-- 3: versioning monotone — les versions précédentes sont droppées.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public'
                AND p.proname IN ('set_setting_v10', 'get_settings_by_category_v8')),
  'set_setting_v10 and get_settings_by_category_v8 are dropped');

-- 4: la catégorie network expose EXACTEMENT une clé.
-- Remise au défaut DANS la transaction (rollback final) : la valeur vivante
-- peut légitimement être true en dev, le test ne doit pas en dépendre.
UPDATE business_config SET offline_payments_enabled = false WHERE id = 1;
SELECT is(
  get_settings_by_category_v10('network')->'settings',
  jsonb_build_object('offline_payments_enabled', false),
  'network category returns exactly the single offline key at default');

-- 5: activation explicite du hors-ligne.
SELECT lives_ok(
  $$SELECT set_setting_v13('offline_payments_enabled', 'true'::jsonb, 'network')$$,
  'set offline_payments_enabled=true succeeds');

-- 6: mauvais type -> rejeté.
SELECT throws_ok(
  $$SELECT set_setting_v13('offline_payments_enabled', '"yes"'::jsonb, 'network')$$,
  '22023', NULL, 'offline_payments_enabled="yes" rejected (expects boolean)');

-- 7: la clé supprimée est désormais INCONNUE (et non plus validée).
SELECT throws_ok(
  $$SELECT set_setting_v13('offline_max_hours', '8'::jsonb, 'network')$$,
  '22023', NULL, 'offline_max_hours is now an unknown setting key');

-- 8: round-trip — l'état final reflète l'écriture.
SELECT is(
  get_settings_by_category_v10('network')->'settings',
  jsonb_build_object('offline_payments_enabled', true),
  'final network settings reflect the round-trip (true)');

-- 9: une branche SANS RAPPORT survit à la dérivation v10 -> v11 (garde-fou
--    contre une découpe qui aurait emporté une partie du CASE).
SELECT lives_ok(
  $$SELECT set_setting_v13('allow_negative_stock', 'true'::jsonb, 'inventory')$$,
  'an unrelated setting branch still works after the v11 derivation');

-- 10: audit row (chemin mutualisé set_setting) avec key/old/new/category.
DO $audit$ DECLARE v_md JSONB; BEGIN
  SELECT metadata INTO v_md
    FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'offline_payments_enabled'
     AND metadata->>'new' = 'true'
   LIMIT 1;
  PERFORM set_config('breakery.t_audit_pass',
    (v_md IS NOT NULL
     AND v_md->>'category' = 'network'
     AND v_md ? 'old')::TEXT, true);
END $audit$;
SELECT ok(current_setting('breakery.t_audit_pass')::BOOLEAN,
  'audit_logs setting.update row for offline_payments_enabled has key/old/new/category');

-- 11: pay_existing_order_v17 porte p_payments ET p_offline_replay.
SELECT ok(
  (SELECT pg_get_function_identity_arguments(p.oid) LIKE '%p_payments jsonb%'
      AND pg_get_function_identity_arguments(p.oid) LIKE '%p_offline_replay boolean%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_existing_order_v17'),
  'pay_existing_order_v17 carries p_payments and p_offline_replay');

-- 12: le multi-règlements est borné 1..5 côté serveur (ADR-015 : le split
--     hors-ligne s'appuie dessus, il ne le contourne pas).
SELECT ok(
  (SELECT prosrc LIKE '%Invalid tender count%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_existing_order_v17'),
  'pay_existing_order_v17 enforces the 1..5 tender bound');

-- 13: p_offline_replay force allow_negative MAIS ne bypasse PAS le gate
--     store_credit — c'est ce qui justifie l'exclusion de l'avoir (ADR-015).
SELECT ok(
  (SELECT prosrc LIKE '%IF p_offline_replay THEN%'
      AND prosrc LIKE '%v_allow_negative := true%'
      AND prosrc LIKE '%Insufficient store credit%'
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pay_existing_order_v17'),
  'offline replay forces allow_negative but the store-credit gate still fires');

-- 14: defense-in-depth — anon n'exécute aucune des 3 fonctions.
SELECT ok(
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('set_setting_v13', 'get_settings_by_category_v10', 'pay_existing_order_v17')),
  'anon has no EXECUTE on set_setting_v13 / get_settings_by_category_v10 / pay_existing_order_v17');

SELECT * FROM finish();
ROLLBACK;
