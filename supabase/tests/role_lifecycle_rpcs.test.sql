-- supabase/tests/role_lifecycle_rpcs.test.sql
-- ADR-032 — pgTAP suite for create_role_v1 / delete_role_v1.
--
-- Coverage (18 tests) :
--   1-3   gates : unauthenticated, forbidden (CASHIER), super_admin_only (ADMIN promu)
--   4-8   validations create : invalid_code, role_exists (insensible à la casse),
--         invalid_name, invalid_minutes, clone_source_not_found
--   9-12  clone de CASHIER : code rendu, is_system=false, grants copiés à
--         l'identique, timeout hérité, audit role.created
--   13    clone de SUPER_ADMIN : rbac.manage EXCLUE de la copie
--   14    delete d'un rôle système → system_role_locked
--   15    delete d'un rôle porté → role_in_use
--   16-17 delete happy path : TRUE, ligne + grants disparus, audit role.deleted
--   18    delete d'un rôle inconnu → role_not_found
--
-- Runner : MCP execute_sql, enveloppe BEGIN ... ROLLBACK.
-- Fixtures seedées : 01 SUPER_ADMIN, 02 CASHIER, 04 MANAGER (promu ADMIN pour T3).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- T1 : unauthenticated
SELECT throws_ok(
  $$SELECT create_role_v1('TEST_BAKER', 'Test Baker')$$,
  'P0003', 'unauthenticated',
  'T1 unauthenticated → P0003'
);

-- T2 : CASHIER → forbidden
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000002', 'role', 'authenticated')::TEXT,
    true);
END $$;

SELECT throws_ok(
  $$SELECT create_role_v1('TEST_BAKER', 'Test Baker')$$,
  'P0003', 'forbidden',
  'T2 CASHIER → P0003 forbidden'
);

-- T3 : ADMIN porteur de rbac.manage (via override) → super_admin_only.
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
  $$SELECT create_role_v1('TEST_BAKER', 'Test Baker')$$,
  'P0003', 'super_admin_only',
  'T3 ADMIN avec rbac.manage → P0003 super_admin_only'
);

-- T4..T18 : appelant SUPER_ADMIN.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::TEXT,
    true);
END $$;

-- T4 : code invalide
SELECT throws_ok(
  $$SELECT create_role_v1('1BAD', 'Bad Code')$$,
  'P0001', 'invalid_code',
  'T4 code invalide → P0001 invalid_code'
);

-- T5 : collision insensible à la casse
SELECT throws_ok(
  $$SELECT create_role_v1('admin', 'Shadow Admin')$$,
  'P0001', 'role_exists',
  'T5 « admin » vs ADMIN → P0001 role_exists'
);

-- T6 : nom invalide
SELECT throws_ok(
  $$SELECT create_role_v1('TEST_BAKER', 'X')$$,
  'P0001', 'invalid_name',
  'T6 nom trop court → P0001 invalid_name'
);

-- T7 : timeout hors bornes
SELECT throws_ok(
  $$SELECT create_role_v1('TEST_BAKER', 'Test Baker', NULL, 4)$$,
  'P0001', 'invalid_minutes',
  'T7 timeout 4 → P0001 invalid_minutes'
);

-- T8 : source de clone inconnue
SELECT throws_ok(
  $$SELECT create_role_v1('TEST_BAKER', 'Test Baker', NULL, NULL, 'NOPE_ROLE')$$,
  'P0002', 'clone_source_not_found',
  'T8 clone source inconnue → P0002 clone_source_not_found'
);

-- T9 : happy path — clone de CASHIER
SELECT is(
  create_role_v1('TEST_BAKER', 'Test Baker', 'pgTAP fixture role', NULL, 'CASHIER'),
  'TEST_BAKER',
  'T9 create clone de CASHIER → rend le code'
);

-- T10 : rôle créé is_system=false, grants copiés à l'identique
SELECT is(
  (SELECT COUNT(*)::INT FROM role_permissions WHERE role_code = 'TEST_BAKER' AND is_granted),
  (SELECT COUNT(*)::INT FROM role_permissions
    WHERE role_code = 'CASHIER' AND is_granted AND permission_code <> 'rbac.manage'),
  'T10 grants copiés = grants CASHIER (hors rbac.manage)'
);

-- T11 : is_system=false et timeout hérité du rôle source
SELECT ok(
  (SELECT NOT is_system
      AND session_timeout_minutes = (SELECT session_timeout_minutes FROM roles WHERE code = 'CASHIER')
   FROM roles WHERE code = 'TEST_BAKER'),
  'T11 rôle créé non-système, timeout hérité de CASHIER'
);

-- T12 : audit role.created, actor = profil 01
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action = 'role.created'
     AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
     AND payload->>'role_code' = 'TEST_BAKER'
     AND payload->>'cloned_from' = 'CASHIER'),
  1,
  'T12 audit role.created avec actor_id = profil'
);

-- T13 : clone de SUPER_ADMIN — rbac.manage exclue
SELECT create_role_v1('TEST_SHADOW', 'Test Shadow', NULL, NULL, 'SUPER_ADMIN');
SELECT is(
  (SELECT COUNT(*)::INT FROM role_permissions
    WHERE role_code = 'TEST_SHADOW' AND permission_code = 'rbac.manage'),
  0,
  'T13 clone de SUPER_ADMIN sans rbac.manage'
);

-- T14 : delete d'un rôle système → system_role_locked
SELECT throws_ok(
  $$SELECT delete_role_v1('CASHIER')$$,
  'P0001', 'system_role_locked',
  'T14 delete CASHIER → P0001 system_role_locked'
);

-- T15 : delete d'un rôle porté → role_in_use
UPDATE user_profiles SET role_code = 'TEST_BAKER'
WHERE id = '00000000-0000-0000-0000-000000000002';

SELECT throws_ok(
  $$SELECT delete_role_v1('TEST_BAKER')$$,
  'P0001', 'role_in_use',
  'T15 delete rôle porté → P0001 role_in_use'
);

UPDATE user_profiles SET role_code = 'CASHIER'
WHERE id = '00000000-0000-0000-0000-000000000002';

-- T16 : delete happy path
SELECT is(
  delete_role_v1('TEST_BAKER'),
  TRUE,
  'T16 delete TEST_BAKER → TRUE'
);

-- T17 : ligne et grants disparus + audit role.deleted
SELECT ok(
  NOT EXISTS (SELECT 1 FROM roles WHERE code = 'TEST_BAKER')
  AND NOT EXISTS (SELECT 1 FROM role_permissions WHERE role_code = 'TEST_BAKER')
  AND EXISTS (SELECT 1 FROM audit_logs
              WHERE action = 'role.deleted'
                AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
                AND payload->>'role_code' = 'TEST_BAKER'),
  'T17 rôle + grants disparus, audit role.deleted écrit'
);

-- T18 : delete d'un rôle inconnu
SELECT throws_ok(
  $$SELECT delete_role_v1('TEST_BAKER')$$,
  'P0002', 'role_not_found',
  'T18 re-delete → P0002 role_not_found'
);

SELECT * FROM finish();
ROLLBACK;
