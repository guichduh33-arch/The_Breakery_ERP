-- supabase/tests/set_role_permission_v1.test.sql
-- ADR-031 — pgTAP suite for set_role_permission_v1.
--
-- Coverage (14 tests) :
--   1. unauthenticated → P0003 'unauthenticated'
--   2. CASHIER (no rbac.manage) → P0003 'forbidden'
--   3. ADMIN with rbac.manage override → P0003 'super_admin_only' (cas discriminant :
--      la permission ne suffit pas, le rôle est le vrai verrou)
--   4. cible SUPER_ADMIN → P0001 'super_admin_row_locked'
--   5. rôle inconnu → P0002 'role_not_found'
--   6. permission inconnue → P0002 'permission_not_found'
--   7-10. grant happy path : TRUE, ligne créée, re-grant no-op FALSE, audit actor=profil
--   11-14. revoke happy path : TRUE, ligne supprimée, audit, re-revoke no-op FALSE
--
-- Runner : MCP execute_sql, enveloppe BEGIN ... ROLLBACK.
-- Fixtures seedées : 01 SUPER_ADMIN, 02 CASHIER, 04 MANAGER (promu ADMIN pour T3).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- T1 : unauthenticated
SELECT throws_ok(
  $$SELECT set_role_permission_v1('CASHIER', 'rbac.manage', true)$$,
  'P0003', 'unauthenticated',
  'T1 unauthenticated → P0003'
);

-- T2 : CASHIER sans rbac.manage → forbidden
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'role', 'authenticated')::TEXT,
    true);
END $$;

SELECT throws_ok(
  $$SELECT set_role_permission_v1('CASHIER', 'rbac.manage', true)$$,
  'P0003', 'forbidden',
  'T2 CASHIER → P0003 forbidden'
);

-- T3 : ADMIN porteur de rbac.manage (via override) → super_admin_only.
-- Le MANAGER de fixture est promu ADMIN dans la transaction (rollback final).
UPDATE user_profiles SET role_code = 'ADMIN'
WHERE id = '00000000-0000-0000-0000-000000000004';

INSERT INTO user_permission_overrides
  (user_profile_id, permission_code, is_granted, reason, granted_by)
VALUES
  ('00000000-0000-0000-0000-000000000004', 'rbac.manage', true,
   'pgTAP T3 fixture', '00000000-0000-0000-0000-000000000001');

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000004', 'role', 'authenticated')::TEXT,
    true);
END $$;

SELECT throws_ok(
  $$SELECT set_role_permission_v1('CASHIER', 'rbac.manage', true)$$,
  'P0003', 'super_admin_only',
  'T3 ADMIN avec rbac.manage → P0003 super_admin_only'
);

-- T4..T14 : appelant SUPER_ADMIN.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::TEXT,
    true);
END $$;

-- T4 : la ligne SUPER_ADMIN est immuable
SELECT throws_ok(
  $$SELECT set_role_permission_v1('SUPER_ADMIN', 'rbac.manage', false)$$,
  'P0001', 'super_admin_row_locked',
  'T4 cible SUPER_ADMIN → P0001 super_admin_row_locked'
);

-- T5 : rôle inconnu
SELECT throws_ok(
  $$SELECT set_role_permission_v1('NOPE_ROLE', 'rbac.manage', true)$$,
  'P0002', 'role_not_found',
  'T5 rôle inconnu → P0002 role_not_found'
);

-- T6 : permission inconnue
SELECT throws_ok(
  $$SELECT set_role_permission_v1('CASHIER', 'nope.permission', true)$$,
  'P0002', 'permission_not_found',
  'T6 permission inconnue → P0002 permission_not_found'
);

-- T7 : grant → TRUE
SELECT is(
  set_role_permission_v1('CASHIER', 'rbac.manage', true),
  TRUE,
  'T7 grant CASHIER rbac.manage → TRUE'
);

-- T8 : la ligne existe
SELECT is(
  (SELECT COUNT(*)::INT FROM role_permissions
   WHERE role_code = 'CASHIER' AND permission_code = 'rbac.manage' AND is_granted),
  1,
  'T8 ligne role_permissions créée'
);

-- T9 : re-grant no-op → FALSE
SELECT is(
  set_role_permission_v1('CASHIER', 'rbac.manage', true),
  FALSE,
  'T9 re-grant → FALSE (idempotent)'
);

-- T10 : audit granted, actor = user_profiles.id de l'appelant
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action = 'role.permission_granted'
     AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
     AND payload->>'role_code' = 'CASHIER'
     AND payload->>'permission_code' = 'rbac.manage'),
  1,
  'T10 audit role.permission_granted avec actor_id = profil'
);

-- T11 : revoke → TRUE
SELECT is(
  set_role_permission_v1('CASHIER', 'rbac.manage', false),
  TRUE,
  'T11 revoke → TRUE'
);

-- T12 : ligne supprimée
SELECT is(
  (SELECT COUNT(*)::INT FROM role_permissions
   WHERE role_code = 'CASHIER' AND permission_code = 'rbac.manage'),
  0,
  'T12 ligne role_permissions supprimée'
);

-- T13 : audit revoked
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action = 'role.permission_revoked'
     AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
     AND payload->>'role_code' = 'CASHIER'
     AND payload->>'permission_code' = 'rbac.manage'),
  1,
  'T13 audit role.permission_revoked avec actor_id = profil'
);

-- T14 : re-revoke no-op → FALSE
SELECT is(
  set_role_permission_v1('CASHIER', 'rbac.manage', false),
  FALSE,
  'T14 re-revoke → FALSE (idempotent)'
);

SELECT * FROM finish();
ROLLBACK;
