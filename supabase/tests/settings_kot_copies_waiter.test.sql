-- supabase/tests/settings_kot_copies_waiter.test.sql
-- S1-22 (migration 20261109000002) — business_config.kot_copies_waiter +
-- RPC set_kot_copies_waiter_v1. Auth pattern : EMP000 (ADMIN) porte
-- settings.update (miroir de settings_kot_copies.test.sql).
--
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK ; verdict : SELECT num_failed().

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(11);

-- Identité ADMIN pour la transaction.
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
    WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- 1: colonne présente, défaut 1 (métadonnée catalogue, indépendante de la valeur courante).
SELECT is(
  (SELECT column_default FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_config'
      AND column_name = 'kot_copies_waiter'),
  '1',
  'business_config.kot_copies_waiter exists with default 1');

-- 2: CHECK [0,5] actif sur la colonne.
SELECT throws_ok(
  $$UPDATE business_config SET kot_copies_waiter = 6 WHERE id = 1$$,
  '23514', NULL, 'CHECK rejects kot_copies_waiter=6');

-- 3: borne basse : 0 = pas de papier.
SELECT lives_ok(
  $$SELECT set_kot_copies_waiter_v1(0)$$,
  'set_kot_copies_waiter_v1(0) succeeds (paper off)');
SELECT is((SELECT kot_copies_waiter FROM business_config WHERE id = 1), 0,
  'column reads 0 after write');

-- 4: borne haute.
SELECT lives_ok(
  $$SELECT set_kot_copies_waiter_v1(5)$$,
  'set_kot_copies_waiter_v1(5) succeeds (upper bound)');

-- 5: hors plage -> setting_value_invalid (22023).
SELECT throws_ok($$SELECT set_kot_copies_waiter_v1(-1)$$, '22023', 'setting_value_invalid',
  'copies=-1 rejected');
SELECT throws_ok($$SELECT set_kot_copies_waiter_v1(6)$$, '22023', 'setting_value_invalid',
  'copies=6 rejected');

-- 6: NULL -> setting_type_invalid (22023). Un non-entier (1.5) ne passe pas
-- la résolution de signature : la contrainte est portée par le type integer.
SELECT throws_ok($$SELECT set_kot_copies_waiter_v1(NULL)$$, '22023', 'setting_type_invalid',
  'copies=NULL rejected');

-- 7: audit — ligne setting.update avec un actor_id de profil (jamais auth.uid()).
DO $audit$
DECLARE v_row audit_logs%ROWTYPE; v_ok BOOLEAN;
BEGIN
  SELECT * INTO v_row FROM audit_logs
   WHERE action = 'setting.update'
     AND metadata->>'key' = 'kot_copies_waiter'
     AND metadata->>'new' = '5'
   LIMIT 1;
  v_ok := v_row.id IS NOT NULL
    AND v_row.metadata->>'category' = 'printing'
    AND v_row.metadata ? 'old'
    AND EXISTS (SELECT 1 FROM user_profiles WHERE id = v_row.actor_id);
  PERFORM set_config('breakery.t_audit_pass', COALESCE(v_ok, false)::TEXT, true);
END $audit$;
SELECT ok(current_setting('breakery.t_audit_pass')::BOOLEAN,
  'audit_logs setting.update row has key/old/new/category and a user_profiles actor_id');

-- 8: refus de permission pour une identité sans droit.
SELECT set_config('request.jwt.claims',
  jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::TEXT, true);
SELECT throws_ok($$SELECT set_kot_copies_waiter_v1(2)$$, '42501', 'permission_denied',
  'user without settings.update is refused');

-- 9: anon n'a pas EXECUTE (REVOKE PUBLIC + anon, règle des grants d'AGENTS.md).
SELECT ok(NOT has_function_privilege('anon', 'public.set_kot_copies_waiter_v1(integer)', 'EXECUTE'),
  'anon cannot execute set_kot_copies_waiter_v1');

SELECT * FROM finish();
ROLLBACK;
