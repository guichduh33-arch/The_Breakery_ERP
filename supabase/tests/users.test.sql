-- supabase/tests/users.test.sql
-- Session 13 / Phase 5.D — pgTAP suite for RBAC user-management RPCs.
--
-- Coverage T_USR_01..10 :
--   T_USR_01 : RPCs exist with expected signatures.
--   T_USR_02 : create_user_v1 input validation.
--   T_USR_03 : create_user_v1 happy path — auth.users + user_profiles + audit.
--   T_USR_04 : update_user_role_v1 — audit row with old_role/new_role/reason.
--   T_USR_05 : update_user_role_v1 — sessions revoked (user_sessions.ended_at set).
--   T_USR_06 : delete_user_v1 happy path — soft-delete + audit.
--   T_USR_07 : delete_user_v1 last-admin protection (SQLSTATE P0001).
--   T_USR_08 : reset_user_pin_v1 happy path — pin_hash updated + lockout cleared.
--   T_USR_09 : update_user_profile_v1 self-edit allowed without users.update perm.
--   T_USR_10 : has_permission() NOT re-CREATEd (body still contains 'user_permission_overrides').
--
-- Runner :
--   Wrapped in BEGIN ... ROLLBACK via Supabase MCP execute_sql.
--   pgTAP extension already enabled.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

-- ---------------------------------------------------------------------------
-- Fixtures : pin a seeded SUPER_ADMIN id to act as caller when needed.
-- pgTAP runs as service_role superuser ; auth.uid() is NULL inside SECURITY
-- DEFINER bodies. We use `SET LOCAL request.jwt.claim.sub = '<uid>'` so
-- auth.uid() resolves to that UUID.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_admin_auth UUID;
  v_admin_prof UUID;
BEGIN
  SELECT auth_user_id, id INTO v_admin_auth, v_admin_prof
    FROM user_profiles WHERE role_code = 'SUPER_ADMIN' AND is_active = true LIMIT 1;
  IF v_admin_auth IS NULL THEN
    RAISE EXCEPTION 'No SUPER_ADMIN seed — abort';
  END IF;
  CREATE TEMP TABLE _usr_ctx (admin_auth UUID, admin_prof UUID);
  INSERT INTO _usr_ctx VALUES (v_admin_auth, v_admin_prof);
END $$;

-- =============================================================================
-- T_USR_01 : RPC signatures exist
-- =============================================================================

SELECT has_function('create_user_v1',
  ARRAY['text','text','text','text'],
  'T_USR_01a create_user_v1(text,text,text,text) exists');

SELECT has_function('update_user_role_v1',
  ARRAY['uuid','text','text'],
  'T_USR_01b update_user_role_v1(uuid,text,text) exists');

SELECT has_function('delete_user_v1',
  ARRAY['uuid','text'],
  'T_USR_01c delete_user_v1(uuid,text) exists');

SELECT has_function('reset_user_pin_v1',
  ARRAY['uuid','text'],
  'T_USR_01d reset_user_pin_v1(uuid,text) exists');

SELECT has_function('update_user_profile_v1',
  ARRAY['uuid','text','text'],
  'T_USR_01e update_user_profile_v1(uuid,text,text) exists');

-- =============================================================================
-- T_USR_02 : create_user_v1 input validation (no auth → 28000)
-- =============================================================================

SELECT throws_ok(
  $$SELECT create_user_v1('USR_T2','Test User','MANAGER','1234')$$,
  '28000',
  NULL,
  'T_USR_02a unauthenticated caller refused'
);

-- Set jwt.claim.sub to admin auth id ; subsequent calls have auth.uid().
DO $$
DECLARE
  v_admin_auth UUID;
BEGIN
  SELECT admin_auth INTO v_admin_auth FROM _usr_ctx;
  PERFORM set_config('request.jwt.claim.sub', v_admin_auth::TEXT, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth::TEXT, 'role', 'authenticated')::TEXT,
    true);
END $$;

SELECT throws_ok(
  $$SELECT create_user_v1('USR','Test User','MANAGER','1234')$$,
  '22023',
  NULL,
  'T_USR_02b short employee_code refused'
);

SELECT throws_ok(
  $$SELECT create_user_v1('USR_T2','T','MANAGER','1234')$$,
  '22023',
  NULL,
  'T_USR_02c short full_name refused'
);

SELECT throws_ok(
  $$SELECT create_user_v1('USR_T2','Test User','MANAGER','12')$$,
  '22023',
  NULL,
  'T_USR_02d short pin refused'
);

SELECT throws_ok(
  $$SELECT create_user_v1('USR_T2','Test User','MANAGER','abcdef')$$,
  '22023',
  NULL,
  'T_USR_02e non-numeric pin refused'
);

-- Pin argument must be a *valid* 6-digit pin here so the flow reaches the
-- role-existence check (pin validation runs before the role check in the
-- function body) — 'NOT_A_ROLE' is what's under test, not the pin.
SELECT throws_ok(
  $$SELECT create_user_v1('USR_T2','Test User','NOT_A_ROLE','123456')$$,
  '23503',
  NULL,
  'T_USR_02f unknown role refused'
);

-- S58 (Vague 0, T3c) : pin must be EXACTLY 6 digits (was 4-8).
SELECT throws_ok(
  $$SELECT create_user_v1('USR_T2','Test User','MANAGER','12345')$$,
  '22023',
  NULL,
  'T_USR_02g 5-digit pin refused (exactly-6 rule)'
);

SELECT throws_ok(
  $$SELECT create_user_v1('USR_T2','Test User','MANAGER','1234567')$$,
  '22023',
  NULL,
  'T_USR_02h 7-digit pin refused (exactly-6 rule)'
);

-- =============================================================================
-- T_USR_03 : create_user_v1 happy path
-- =============================================================================

DO $$
DECLARE
  v_new_id UUID;
  v_auth_id UUID;
  v_audit_count INTEGER;
BEGIN
  v_new_id := create_user_v1('USR_T3','Phase 5D Test User','CASHIER','555444');
  SELECT auth_user_id INTO v_auth_id FROM user_profiles WHERE id = v_new_id;
  PERFORM set_config('test.usr_t3_id',      v_new_id::TEXT, true);
  PERFORM set_config('test.usr_t3_auth',    v_auth_id::TEXT, true);

  SELECT count(*) INTO v_audit_count FROM audit_logs
    WHERE entity_type='user_profile' AND entity_id=v_new_id AND action='user.create';
  PERFORM set_config('test.usr_t3_audit', v_audit_count::TEXT, true);
END $$;

SELECT is(
  (SELECT employee_code FROM user_profiles
     WHERE id = current_setting('test.usr_t3_id')::UUID),
  'USR_T3',
  'T_USR_03a user_profiles row created with employee_code'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM auth.users
     WHERE id = current_setting('test.usr_t3_auth')::UUID),
  1,
  'T_USR_03b auth.users row created'
);

SELECT is(
  current_setting('test.usr_t3_audit')::INTEGER,
  1,
  'T_USR_03c audit row inserted on create'
);

-- =============================================================================
-- T_USR_04 : update_user_role_v1 — audit + metadata
-- =============================================================================

DO $$
DECLARE
  v_id UUID := current_setting('test.usr_t3_id')::UUID;
  v_res JSONB;
BEGIN
  v_res := update_user_role_v1(v_id, 'MANAGER', 'promotion to shift lead');
  PERFORM set_config('test.usr_t4_res', v_res::TEXT, true);
END $$;

SELECT is(
  (SELECT role_code FROM user_profiles
     WHERE id = current_setting('test.usr_t3_id')::UUID),
  'MANAGER',
  'T_USR_04a role_code updated to MANAGER'
);

SELECT ok(
  (SELECT EXISTS(
     SELECT 1 FROM audit_logs
      WHERE entity_type='user_role'
        AND entity_id = current_setting('test.usr_t3_id')::UUID
        AND action='user.role_change'
        AND metadata->>'old_role' = 'CASHIER'
        AND metadata->>'new_role' = 'MANAGER'
        AND metadata->>'reason' LIKE 'promotion%'
  )),
  'T_USR_04b audit row written with old/new/reason metadata'
);

-- =============================================================================
-- T_USR_05 : update_user_role_v1 — sessions revoked
-- =============================================================================

DO $$
DECLARE
  v_id UUID := current_setting('test.usr_t3_id')::UUID;
  v_token TEXT := gen_random_uuid()::TEXT;  -- 36 chars → trigger hashes it
  v_res JSONB;
BEGIN
  -- Plant a fake active session
  INSERT INTO user_sessions (user_id, session_token_hash, device_type)
  VALUES (v_id, v_token, 'pos');

  -- Role-change again
  v_res := update_user_role_v1(v_id, 'CASHIER', 'demotion test');
  PERFORM set_config('test.usr_t5_res', v_res::TEXT, true);
END $$;

SELECT ok(
  (SELECT (current_setting('test.usr_t5_res')::JSONB)->>'revoked_session_count' = '1'),
  'T_USR_05a revoked_session_count = 1'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM user_sessions
     WHERE user_id = current_setting('test.usr_t3_id')::UUID
       AND ended_at IS NULL),
  0,
  'T_USR_05b no remaining active sessions'
);

-- =============================================================================
-- T_USR_06 : delete_user_v1 happy path
-- =============================================================================

DO $$
DECLARE
  v_id UUID := current_setting('test.usr_t3_id')::UUID;
  v_res JSONB;
BEGIN
  v_res := delete_user_v1(v_id, 'left the company');
  PERFORM set_config('test.usr_t6_res', v_res::TEXT, true);
END $$;

SELECT ok(
  (SELECT deleted_at IS NOT NULL AND is_active = false
     FROM user_profiles WHERE id = current_setting('test.usr_t3_id')::UUID),
  'T_USR_06a soft-deleted (deleted_at set, is_active false)'
);

SELECT ok(
  (SELECT EXISTS(
     SELECT 1 FROM audit_logs
      WHERE entity_type='user_profile'
        AND entity_id = current_setting('test.usr_t3_id')::UUID
        AND action='user.delete'
        AND metadata->>'reason' = 'left the company'
  )),
  'T_USR_06b audit row recorded'
);

-- =============================================================================
-- T_USR_07 : delete_user_v1 LAST_ADMIN_PROTECTED
-- =============================================================================

SELECT throws_ok(
  format($f$SELECT delete_user_v1(%L::UUID, 'attempt to remove last admin')$f$,
         (SELECT admin_prof FROM _usr_ctx)),
  'P0001',
  NULL,
  'T_USR_07 last admin / super-admin cannot be deleted (P0001 LAST_ADMIN_PROTECTED)'
);

-- =============================================================================
-- T_USR_08 : reset_user_pin_v1 happy path
-- =============================================================================

-- Re-create another user to test (the T_USR_03 user is now soft-deleted).
DO $$
DECLARE
  v_new_id UUID;
BEGIN
  v_new_id := create_user_v1('USR_T8','Pin Reset Target','CASHIER','999888');
  -- Simulate a lockout
  UPDATE user_profiles SET failed_login_attempts = 5,
                           locked_until = now() + interval '15 minutes'
   WHERE id = v_new_id;
  PERFORM set_config('test.usr_t8_id', v_new_id::TEXT, true);

  PERFORM reset_user_pin_v1(v_new_id, '777666');
END $$;

SELECT ok(
  (SELECT failed_login_attempts = 0 AND locked_until IS NULL
     FROM user_profiles WHERE id = current_setting('test.usr_t8_id')::UUID),
  'T_USR_08a lockout cleared by reset_user_pin_v1'
);

SELECT ok(
  (SELECT verify_user_pin(current_setting('test.usr_t8_id')::UUID, '777666')),
  'T_USR_08b new PIN verifies'
);

SELECT ok(
  (SELECT EXISTS(
     SELECT 1 FROM audit_logs
      WHERE action = 'user.pin_reset'
        AND entity_id = current_setting('test.usr_t8_id')::UUID
  )),
  'T_USR_08c audit row written for pin_reset'
);

-- =============================================================================
-- T_USR_09 : update_user_profile_v1 — self-edit allowed without users.update
-- =============================================================================

-- Switch caller to the freshly-created T8 user (cashier role, no users.update).
DO $$
DECLARE
  v_target_id   UUID := current_setting('test.usr_t8_id')::UUID;
  v_target_auth UUID;
BEGIN
  SELECT auth_user_id INTO v_target_auth FROM user_profiles WHERE id = v_target_id;
  PERFORM set_config('request.jwt.claim.sub', v_target_auth::TEXT, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_target_auth::TEXT, 'role', 'authenticated')::TEXT,
    true);

  PERFORM update_user_profile_v1(v_target_id, 'Pin Reset Target (renamed)', 'USR_T8');
END $$;

SELECT is(
  (SELECT full_name FROM user_profiles
     WHERE id = current_setting('test.usr_t8_id')::UUID),
  'Pin Reset Target (renamed)',
  'T_USR_09 self-edit of full_name accepted without users.update'
);

-- =============================================================================
-- T_USR_10 : has_permission() NOT re-CREATEd this migration
-- =============================================================================

SELECT ok(
  (SELECT prosrc LIKE '%user_permission_overrides%'
     FROM pg_proc WHERE proname = 'has_permission' LIMIT 1),
  'T_USR_10 has_permission() body still references user_permission_overrides (locked since Phase 1.B)'
);

SELECT * FROM finish();

ROLLBACK;
