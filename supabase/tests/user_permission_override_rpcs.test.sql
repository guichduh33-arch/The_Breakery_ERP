-- supabase/tests/user_permission_override_rpcs.test.sql
-- ADR-031 — pgTAP suite for set_user_permission_override_v1 / delete_user_permission_override_v1.
--
-- Coverage (17 tests) :
--   1. unauthenticated → P0003
--   2. CASHIER → P0003 'forbidden'
--   3. cible profil SUPER_ADMIN → P0001 'super_admin_target_locked'
--   4. profil inconnu → P0002 'profile_not_found'
--   5. reason trop courte → P0001 'invalid_reason'
--   6. expiry passée → P0001 'invalid_expiry'
--   7. permission inconnue → P0002 'permission_not_found'
--   8-10. set happy path : TRUE, ligne créée, audit actor=profil
--   11-13. upsert DENY : TRUE, is_granted=false, audit avec before
--   14-16. delete : TRUE, ligne supprimée, audit removed
--   17. re-delete no-op → FALSE
--
-- Runner : MCP execute_sql, enveloppe BEGIN ... ROLLBACK.
-- Fixtures seedées : 01 SUPER_ADMIN, 02 CASHIER.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(17);

-- T1 : unauthenticated
SELECT throws_ok(
  $$SELECT set_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read', true, 'pgTAP reason')$$,
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
  $$SELECT set_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read', true, 'pgTAP reason')$$,
  'P0003', 'forbidden',
  'T2 CASHIER → P0003 forbidden'
);

-- T3..T17 : appelant SUPER_ADMIN.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-0000-0000-000000000001', 'role', 'authenticated')::TEXT,
    true);
END $$;

-- T3 : cible SUPER_ADMIN interdite
SELECT throws_ok(
  $$SELECT set_user_permission_override_v1('00000000-0000-0000-0000-000000000001', 'reports.audit.read', false, 'pgTAP reason')$$,
  'P0001', 'super_admin_target_locked',
  'T3 cible profil SUPER_ADMIN → P0001 super_admin_target_locked'
);

-- T4 : profil inconnu
SELECT throws_ok(
  $$SELECT set_user_permission_override_v1('ffffffff-ffff-ffff-ffff-ffffffffffff', 'reports.audit.read', true, 'pgTAP reason')$$,
  'P0002', 'profile_not_found',
  'T4 profil inconnu → P0002 profile_not_found'
);

-- T5 : reason trop courte
SELECT throws_ok(
  $$SELECT set_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read', true, 'ab')$$,
  'P0001', 'invalid_reason',
  'T5 reason 2 chars → P0001 invalid_reason'
);

-- T6 : expiry passée
SELECT throws_ok(
  $$SELECT set_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read', true, 'pgTAP reason', now() - interval '1 day')$$,
  'P0001', 'invalid_expiry',
  'T6 expiry passée → P0001 invalid_expiry'
);

-- T7 : permission inconnue
SELECT throws_ok(
  $$SELECT set_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'nope.permission', true, 'pgTAP reason')$$,
  'P0002', 'permission_not_found',
  'T7 permission inconnue → P0002 permission_not_found'
);

-- T8 : set GRANT → TRUE
SELECT is(
  set_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read', true, 'pgTAP grant fixture'),
  TRUE,
  'T8 set override GRANT → TRUE'
);

-- T9 : ligne créée
SELECT is(
  (SELECT o.is_granted FROM user_permission_overrides o
   WHERE o.user_profile_id = '00000000-0000-0000-0000-000000000002'
     AND o.permission_code = 'reports.audit.read'),
  TRUE,
  'T9 ligne override créée is_granted=true'
);

-- T10 : audit set, actor = profil appelant
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action = 'user.permission_override_set'
     AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
     AND entity_id = '00000000-0000-0000-0000-000000000002'::UUID
     AND payload->>'permission_code' = 'reports.audit.read'),
  1,
  'T10 audit user.permission_override_set avec actor_id = profil'
);

-- T11 : upsert en DENY → TRUE
SELECT is(
  set_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read', false, 'pgTAP deny fixture'),
  TRUE,
  'T11 upsert DENY → TRUE'
);

-- T12 : la ligne est passée à false
SELECT is(
  (SELECT o.is_granted FROM user_permission_overrides o
   WHERE o.user_profile_id = '00000000-0000-0000-0000-000000000002'
     AND o.permission_code = 'reports.audit.read'),
  FALSE,
  'T12 override upserté is_granted=false'
);

-- T13 : l'audit du 2e set porte le before (is_granted=true)
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action = 'user.permission_override_set'
     AND entity_id = '00000000-0000-0000-0000-000000000002'::UUID
     AND payload->'before'->>'is_granted' = 'true'),
  1,
  'T13 audit du 2e set porte before.is_granted=true'
);

-- T14 : delete → TRUE
SELECT is(
  delete_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read'),
  TRUE,
  'T14 delete override → TRUE'
);

-- T15 : ligne supprimée
SELECT is(
  (SELECT COUNT(*)::INT FROM user_permission_overrides
   WHERE user_profile_id = '00000000-0000-0000-0000-000000000002'
     AND permission_code = 'reports.audit.read'),
  0,
  'T15 ligne override supprimée'
);

-- T16 : audit removed
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
   WHERE action = 'user.permission_override_removed'
     AND actor_id = '00000000-0000-0000-0000-000000000001'::UUID
     AND entity_id = '00000000-0000-0000-0000-000000000002'::UUID),
  1,
  'T16 audit user.permission_override_removed'
);

-- T17 : re-delete no-op → FALSE
SELECT is(
  delete_user_permission_override_v1('00000000-0000-0000-0000-000000000002', 'reports.audit.read'),
  FALSE,
  'T17 re-delete → FALSE (idempotent)'
);

SELECT * FROM finish();
ROLLBACK;
