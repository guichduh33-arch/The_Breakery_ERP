-- supabase/tests/update_role_session_timeout_v1.test.sql
-- Session 19 / Phase 1.B — pgTAP suite for update_role_session_timeout_v1.
--
-- Coverage (7 tests) :
--   1. unauthenticated caller raises P0003 'unauthenticated'
--   2. CASHIER caller (no settings.update perm) raises P0003 'forbidden'
--   3. Non-admin with overridden settings.update perm raises P0003 'admin_only'
--   4. bounds (4 minutes) raises P0001 'invalid_minutes'
--   5. unknown role code raises P0002 'role_not_found'
--   6. happy path mutates value
--   7. audit log row written with correct payload
--
-- Runner :
--   Wrapped in BEGIN ... ROLLBACK via Supabase MCP execute_sql.
--   pgTAP extension already enabled.
--
-- Caller identity pattern (matches users.test.sql lines 82-92) :
--   set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)
--   -> auth.uid() resolves to the embedded sub.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- ---------------------------------------------------------------------------
-- Fixtures : seeded user UUIDs.
--   SUPER_ADMIN : 00000000-0000-0000-0000-000000000001
--   CASHIER     : 00000000-0000-0000-0000-000000000002
--   MANAGER     : 00000000-0000-0000-0000-000000000004
-- ---------------------------------------------------------------------------

-- =============================================================================
-- T1 : unauthenticated caller → P0003 'unauthenticated'
-- =============================================================================

-- No JWT set : auth.uid() returns NULL.
SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('CASHIER', 60)$$,
  'P0003',
  'unauthenticated',
  'T1 unauthenticated caller → P0003 unauthenticated'
);

-- =============================================================================
-- T2 : CASHIER (no settings.update perm) → P0003 'forbidden'
-- =============================================================================

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'role', 'authenticated')::TEXT,
    true);
END $$;

SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('CASHIER', 60)$$,
  'P0003',
  'forbidden',
  'T2 CASHIER caller (no perm) → P0003 forbidden'
);

-- =============================================================================
-- T3 : non-admin with settings.update override → P0003 'admin_only'
-- =============================================================================
-- Grant settings.update to MANAGER via override, then call as MANAGER.

INSERT INTO user_permission_overrides
  (user_profile_id, permission_code, is_granted, reason, granted_at, granted_by)
VALUES
  ('00000000-0000-0000-0000-000000000004', 'settings.update', true,
   'pgTAP T3 fixture', NOW(), '00000000-0000-0000-0000-000000000001');

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000004', 'role', 'authenticated')::TEXT,
    true);
END $$;

SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('CASHIER', 60)$$,
  'P0003',
  'admin_only',
  'T3 MANAGER with settings.update override → P0003 admin_only'
);

-- =============================================================================
-- T4..T7 : promote caller to SUPER_ADMIN for remaining tests.
-- =============================================================================

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::TEXT,
    true);
END $$;

-- =============================================================================
-- T4 : bounds (4 minutes) → P0001 'invalid_minutes'
-- =============================================================================

SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('CASHIER', 4)$$,
  'P0001',
  'invalid_minutes',
  'T4 4 minutes → P0001 invalid_minutes'
);

-- =============================================================================
-- T5 : unknown role → P0002 'role_not_found'
-- =============================================================================

SELECT throws_ok(
  $$SELECT update_role_session_timeout_v1('NOPE_DOES_NOT_EXIST', 60)$$,
  'P0002',
  'role_not_found',
  'T5 unknown role → P0002 role_not_found'
);

-- =============================================================================
-- T6 : happy path mutates value
-- =============================================================================

SELECT update_role_session_timeout_v1('CASHIER', 45);

SELECT is(
  (SELECT session_timeout_minutes FROM roles WHERE code = 'CASHIER'),
  45,
  'T6 CASHIER timeout updated to 45'
);

-- =============================================================================
-- T7 : audit log row written with correct payload
-- =============================================================================

SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action  = 'role.session_timeout_changed'
     AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
     AND payload->>'role_code' = 'CASHIER'
     AND (payload->>'after')::INT = 45),
  1,
  'T7 audit log row written with role_code=CASHIER after=45'
);

SELECT * FROM finish();
ROLLBACK;
