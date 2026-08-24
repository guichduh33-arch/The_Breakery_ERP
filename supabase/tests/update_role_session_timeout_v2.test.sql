-- supabase/tests/update_role_session_timeout_v2.test.sql
-- ADR-031 — pgTAP suite for update_role_session_timeout_v2 (gate SUPER_ADMIN seul).
--
-- Coverage (8 tests) :
--   1. unauthenticated caller raises P0003 'unauthenticated'
--   2. CASHIER caller (no settings.update perm) raises P0003 'forbidden'
--   3. MANAGER with settings.update override raises P0003 'super_admin_only'
--   4. ADMIN (role promu, settings.update via override) raises P0003 'super_admin_only'
--      — cas discriminant de l'ADR-031 : ADMIN perd l'édition des timeouts
--   5. bounds (4 minutes) raises P0001 'invalid_minutes'
--   6. unknown role code raises P0002 'role_not_found'
--   7. happy path mutates value
--   8. audit log row written with actor_id = user_profiles.id
--
-- Runner :
--   Wrapped in BEGIN ... ROLLBACK via Supabase MCP execute_sql.
--
-- Caller identity pattern :
--   set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true)
--   -> auth.uid() resolves to the embedded sub.
--   Fixtures seedées : 01 SUPER_ADMIN, 02 CASHIER, 04 MANAGER (promu ADMIN pour T4).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- =============================================================================
-- T1 : unauthenticated caller → P0003 'unauthenticated'
-- =============================================================================

SELECT throws_ok(
  $$SELECT update_role_session_timeout_v2('CASHIER', 60)$$,
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
  $$SELECT update_role_session_timeout_v2('CASHIER', 60)$$,
  'P0003',
  'forbidden',
  'T2 CASHIER caller (no perm) → P0003 forbidden'
);

-- =============================================================================
-- T3 : MANAGER with settings.update override → P0003 'super_admin_only'
-- =============================================================================

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
  $$SELECT update_role_session_timeout_v2('CASHIER', 60)$$,
  'P0003',
  'super_admin_only',
  'T3 MANAGER with settings.update override → P0003 super_admin_only'
);

-- =============================================================================
-- T4 : ADMIN → P0003 'super_admin_only' (ADR-031 : ADMIN perd l'édition)
-- =============================================================================
-- Le MANAGER de fixture est promu ADMIN dans la transaction (rollback final).

UPDATE user_profiles SET role_code = 'ADMIN'
WHERE id = '00000000-0000-0000-0000-000000000004';

SELECT throws_ok(
  $$SELECT update_role_session_timeout_v2('CASHIER', 60)$$,
  'P0003',
  'super_admin_only',
  'T4 ADMIN → P0003 super_admin_only'
);

-- =============================================================================
-- T5..T8 : promote caller to SUPER_ADMIN for remaining tests.
-- =============================================================================

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::TEXT,
    true);
END $$;

-- T5 : bounds (4 minutes) → P0001 'invalid_minutes'
SELECT throws_ok(
  $$SELECT update_role_session_timeout_v2('CASHIER', 4)$$,
  'P0001',
  'invalid_minutes',
  'T5 4 minutes → P0001 invalid_minutes'
);

-- T6 : unknown role → P0002 'role_not_found'
SELECT throws_ok(
  $$SELECT update_role_session_timeout_v2('NOPE_DOES_NOT_EXIST', 60)$$,
  'P0002',
  'role_not_found',
  'T6 unknown role → P0002 role_not_found'
);

-- T7 : happy path mutates value
SELECT update_role_session_timeout_v2('CASHIER', 45);

SELECT is(
  (SELECT session_timeout_minutes FROM roles WHERE code = 'CASHIER'),
  45,
  'T7 CASHIER timeout updated to 45'
);

-- T8 : audit log row written, actor_id = user_profiles.id de l'appelant
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action  = 'role.session_timeout_changed'
     AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
     AND payload->>'role_code' = 'CASHIER'
     AND (payload->>'after')::INT = 45),
  1,
  'T8 audit log row written with role_code=CASHIER after=45'
);

SELECT * FROM finish();
ROLLBACK;
