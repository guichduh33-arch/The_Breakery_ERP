-- supabase/tests/b2b_settings.test.sql
-- Session 39 Wave A Task A5 (BO-15) — get_b2b_settings_v1 + update_b2b_settings_v1.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK) ou psycopg2.
--
-- Couverture :
--   T1  get_b2b_settings_v1 happy path (MANAGER — settings.read)
--   T2  get_b2b_settings_v1 permission gate — CASHIER → P0003
--   T3  update_b2b_settings_v1 happy path (SUPER_ADMIN — settings.update)
--   T4  update_b2b_settings_v1 permission gate — MANAGER → P0003
--   T5  default_payment_terms not in available_payment_terms → P0001
--   T6  non-contiguous aging_buckets → P0001
--   T7  critical_overdue_days = 0 → P0001
--   T8  partial patch leaves other columns unchanged
--   T9  has_function_privilege anon = false on both RPCs
--   T10 audit row exists after T3 update

BEGIN;
SELECT plan(10);

-- ============================================================
-- Setup : find callers by role.
-- SUPER_ADMIN : auth_user_id 00000000-…-0001
-- MANAGER     : auth_user_id 00000000-…-0004
-- CASHIER     : auth_user_id 00000000-…-0002
-- ============================================================
DO $$
DECLARE
  v_super_auth UUID;
  v_manager_auth UUID;
  v_cashier_auth UUID;
  v_super_prof UUID;
  v_audit_base INT;
BEGIN
  SELECT auth_user_id, id INTO v_super_auth, v_super_prof
    FROM user_profiles WHERE role_code = 'SUPER_ADMIN' AND deleted_at IS NULL AND auth_user_id IS NOT NULL LIMIT 1;

  SELECT auth_user_id INTO v_manager_auth
    FROM user_profiles WHERE role_code = 'MANAGER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL LIMIT 1;

  SELECT auth_user_id INTO v_cashier_auth
    FROM user_profiles WHERE role_code = 'CASHIER' AND deleted_at IS NULL AND auth_user_id IS NOT NULL LIMIT 1;

  -- Save for later DO blocks
  PERFORM set_config('breakery.super_auth',   v_super_auth::text,   true);
  PERFORM set_config('breakery.super_prof',   v_super_prof::text,   true);
  PERFORM set_config('breakery.manager_auth', v_manager_auth::text, true);
  PERFORM set_config('breakery.cashier_auth', v_cashier_auth::text, true);

  -- Baseline audit count (before T3 writes)
  SELECT count(*)::int INTO v_audit_base
    FROM audit_logs WHERE action = 'b2b_settings.updated';
  PERFORM set_config('breakery.audit_base', v_audit_base::text, true);

  -- Reset singleton to known defaults for test isolation
  UPDATE b2b_settings SET
    default_payment_terms   = 'net_30',
    available_payment_terms = '["cod","net_7","net_14","net_30","net_60"]',
    critical_overdue_days   = 30,
    aging_buckets           = '[{"label":"Current","min":0,"max":30},{"label":"Overdue","min":31,"max":60},{"label":"Critical","min":61,"max":null}]',
    updated_at              = now()
  WHERE id = 1;
END $$;


-- ============================================================
-- T1 : get_b2b_settings_v1 happy path — MANAGER
-- ============================================================
DO $$
DECLARE v_auth UUID := current_setting('breakery.manager_auth')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_auth)::text, true);
END $$;

DO $$
DECLARE
  v_result JSONB;
  v_ok BOOLEAN;
BEGIN
  v_result := get_b2b_settings_v1();
  v_ok := (v_result ? 'default_payment_terms')
       AND (v_result ? 'available_payment_terms')
       AND (v_result ? 'critical_overdue_days')
       AND (v_result ? 'aging_buckets');
  PERFORM set_config('breakery.t1_ok', v_ok::text, true);
END $$;

SELECT is(current_setting('breakery.t1_ok'), 'true',
  'T1 MANAGER → get_b2b_settings_v1 returns object with expected keys');


-- ============================================================
-- T2 : get_b2b_settings_v1 permission gate — CASHIER → P0003
-- ============================================================
DO $$
DECLARE v_auth UUID := current_setting('breakery.cashier_auth')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_auth)::text, true);
END $$;

SELECT throws_ok(
  $$ SELECT get_b2b_settings_v1() $$,
  'P0003', NULL,
  'T2 CASHIER → get_b2b_settings_v1 raises P0003');


-- ============================================================
-- T3 : update_b2b_settings_v1 happy path — SUPER_ADMIN
-- ============================================================
DO $$
DECLARE v_auth UUID := current_setting('breakery.super_auth')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_auth)::text, true);
END $$;

DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
  v_prof   UUID := current_setting('breakery.super_prof')::uuid;
BEGIN
  v_result := update_b2b_settings_v1(
    '{"critical_overdue_days": 45, "default_payment_terms": "net_14"}'::jsonb
  );
  -- Check row was updated
  v_ok := (v_result->>'critical_overdue_days')::int = 45
       AND (v_result->>'default_payment_terms') = 'net_14'
       AND (v_result->>'updated_by')::uuid = v_prof;
  PERFORM set_config('breakery.t3_ok', v_ok::text, true);
END $$;

SELECT is(current_setting('breakery.t3_ok'), 'true',
  'T3 SUPER_ADMIN → update_b2b_settings_v1 updates row + sets updated_by');


-- ============================================================
-- T4 : update_b2b_settings_v1 permission gate — MANAGER → P0003
-- (MANAGER has settings.read but NOT settings.update)
-- ============================================================
DO $$
DECLARE v_auth UUID := current_setting('breakery.manager_auth')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_auth)::text, true);
END $$;

SELECT throws_ok(
  $$ SELECT update_b2b_settings_v1('{"critical_overdue_days": 10}'::jsonb) $$,
  'P0003', NULL,
  'T4 MANAGER → update_b2b_settings_v1 raises P0003 (no settings.update)');


-- ============================================================
-- T5 : default_payment_terms not in available_payment_terms → P0001
-- ============================================================
DO $$
DECLARE v_auth UUID := current_setting('breakery.super_auth')::uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims',    json_build_object('sub', v_auth)::text, true);
END $$;

SELECT throws_ok(
  $$ SELECT update_b2b_settings_v1(
       '{"default_payment_terms": "net_90"}'::jsonb
     ) $$,
  'P0001', NULL,
  'T5 default_payment_terms not in available → P0001');


-- ============================================================
-- T6 : non-contiguous aging_buckets → P0001
-- (min 32 instead of 31 — gap at day 31)
-- ============================================================
SELECT throws_ok(
  $$ SELECT update_b2b_settings_v1(
       '{"aging_buckets": [
           {"label":"A","min":0,"max":30},
           {"label":"B","min":32,"max":null}
         ]}'::jsonb
     ) $$,
  'P0001', NULL,
  'T6 non-contiguous aging_buckets → P0001');


-- ============================================================
-- T7 : critical_overdue_days = 0 → P0001 (must be 1..365)
-- ============================================================
SELECT throws_ok(
  $$ SELECT update_b2b_settings_v1('{"critical_overdue_days": 0}'::jsonb) $$,
  'P0001', NULL,
  'T7 critical_overdue_days = 0 → P0001');


-- ============================================================
-- T8 : partial patch leaves untouched columns unchanged
-- ============================================================
DO $$
DECLARE
  v_before JSONB;
  v_after  JSONB;
  v_ok     BOOLEAN;
BEGIN
  -- Read current state (set by T3 above)
  SELECT to_jsonb(s.*) INTO v_before FROM b2b_settings s WHERE id = 1;

  v_after := update_b2b_settings_v1('{"critical_overdue_days": 60}'::jsonb);

  v_ok := (v_after->>'critical_overdue_days')::int = 60
       -- available_payment_terms unchanged
       AND (v_after->'available_payment_terms') = (v_before->'available_payment_terms')
       -- default_payment_terms still as set by T3
       AND (v_after->>'default_payment_terms') = (v_before->>'default_payment_terms');

  PERFORM set_config('breakery.t8_ok', v_ok::text, true);
END $$;

SELECT is(current_setting('breakery.t8_ok'), 'true',
  'T8 partial patch only changes critical_overdue_days, leaves other columns unchanged');


-- ============================================================
-- T9 : REVOKE — anon cannot EXECUTE either RPC
-- ============================================================
SELECT is(
  (
    SELECT has_function_privilege('anon', 'public.get_b2b_settings_v1()', 'EXECUTE')
        OR has_function_privilege('anon', 'public.update_b2b_settings_v1(jsonb)', 'EXECUTE')
  ),
  false,
  'T9 anon has no EXECUTE privilege on get/update_b2b_settings RPCs');


-- ============================================================
-- T10 : audit log row exists after T3 update
-- ============================================================
SELECT is(
  (
    SELECT (count(*)::int - current_setting('breakery.audit_base')::int)
    FROM audit_logs
    WHERE action = 'b2b_settings.updated'
  ),
  2,  -- T3 wrote one row, T8 wrote another (both by SUPER_ADMIN)
  'T10 audit_logs has 2 b2b_settings.updated rows since start of test');


SELECT * FROM finish();
ROLLBACK;
