-- supabase/tests/list_login_users.test.sql
-- S58 (Vague 0, Tâche 3a) — pgTAP suite for `list_login_users_v1`.
--
-- Coverage:
--   T1 : anon CAN execute (this is the FIRST legitimate anon-callable
--        function on the project — pre-auth login picker).
--   T2 : authenticated CAN execute too (shared-terminal user switch).
--   T3 : excludes inactive users (SYS-CRON seed row, is_active = false).
--   T4 : excludes soft-deleted users.
--   T5 : does not expose sensitive columns (pin_hash, employee_code,
--        failed_login_attempts, locked_until, last_login_at, auth_user_id).
--   T6 : returns known active seed users (sanity — picker isn't empty).
--
-- Runner: wrapped in BEGIN ... ROLLBACK via Supabase MCP execute_sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- =============================================================================
-- T1 : anon can execute
-- =============================================================================

SELECT ok(
  has_function_privilege('anon', 'public.list_login_users_v1()', 'EXECUTE'),
  'T1 anon CAN execute list_login_users_v1 (pre-auth login picker)'
);

-- =============================================================================
-- T2 : authenticated can execute
-- =============================================================================

SELECT ok(
  has_function_privilege('authenticated', 'public.list_login_users_v1()', 'EXECUTE'),
  'T2 authenticated CAN execute list_login_users_v1'
);

-- =============================================================================
-- T3 : excludes inactive users (SYS-CRON seed, is_active = false)
-- =============================================================================

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.list_login_users_v1() u
     WHERE u.id = '00000000-0000-0000-0000-000000000999'
  ),
  'T3 inactive seed user (SYS-CRON) excluded from picker'
);

-- =============================================================================
-- T4 : excludes soft-deleted users
-- =============================================================================

-- create_user_v1 requires an authenticated caller with users.create — pgTAP
-- runs as service_role/superuser so auth.uid() is NULL by default. Impersonate
-- the seeded SUPER_ADMIN via request.jwt.claim.sub (same fixture as
-- users.test.sql T_USR_02+).
DO $$
DECLARE
  v_admin_auth UUID;
  v_new_id     UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_auth
    FROM user_profiles WHERE role_code = 'SUPER_ADMIN' AND is_active = true LIMIT 1;
  IF v_admin_auth IS NULL THEN
    RAISE EXCEPTION 'No SUPER_ADMIN seed — abort';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::TEXT, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth::TEXT, 'role', 'authenticated')::TEXT,
    true);

  v_new_id := create_user_v1('USR_LLU4', 'Soft Deleted Test', 'CASHIER', '135790');
  UPDATE user_profiles SET deleted_at = now(), is_active = false WHERE id = v_new_id;
  PERFORM set_config('test.llu4_id', v_new_id::TEXT, true);
END $$;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.list_login_users_v1() u
     WHERE u.id = current_setting('test.llu4_id')::UUID
  ),
  'T4 soft-deleted user excluded from picker'
);

-- =============================================================================
-- T5 : minimal exposure — no sensitive columns in the return signature
-- =============================================================================

SELECT ok(
  pg_get_function_result('public.list_login_users_v1()'::regprocedure) !~* 'pin_hash',
  'T5a return signature does not expose pin_hash'
);

SELECT ok(
  pg_get_function_result('public.list_login_users_v1()'::regprocedure)
    !~* 'employee_code|failed_login_attempts|locked_until|last_login_at|auth_user_id',
  'T5b return signature does not expose employee_code/lockout/last_login/auth_user_id'
);

-- =============================================================================
-- T6 : returns known active seed users (sanity — picker isn't empty)
-- =============================================================================

SELECT ok(
  (SELECT count(*) FROM public.list_login_users_v1()) >= 3,
  'T6 picker returns at least the 3 core active seed users'
);

SELECT * FROM finish();

ROLLBACK;
