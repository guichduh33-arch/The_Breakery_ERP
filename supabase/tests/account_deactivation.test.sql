-- S1-07 — un compte désactivé perd ses droits, et la désactivation est un geste
-- gardé, tracé, qui coupe les sessions. Fixtures dédiées, transaction annulée.
BEGIN;
SELECT no_plan();

CREATE TEMP TABLE deact_fixture(name text PRIMARY KEY, profile_id uuid, auth_id uuid);
INSERT INTO deact_fixture SELECT name, gen_random_uuid(), gen_random_uuid()
FROM unnest(ARRAY['super','admin','custom','cashier','plain']) name;
INSERT INTO auth.users(id) SELECT auth_id FROM deact_fixture;
INSERT INTO roles(code, name, is_system) VALUES ('DEACT_TEST', 'Deactivation test', false);
INSERT INTO user_profiles(id, auth_user_id, role_code, employee_code, full_name, pin_hash, is_active)
SELECT profile_id, auth_id,
  CASE name WHEN 'super' THEN 'SUPER_ADMIN' WHEN 'admin' THEN 'ADMIN'
    WHEN 'custom' THEN 'DEACT_TEST' ELSE 'CASHIER' END,
  'DEACT-' || left(profile_id::text, 8), 'Deact ' || name, hash_pin('285741'), true
FROM deact_fixture;
-- `users.update` pour ceux qui agissent ; `plain` n'a rien. `cashier` porte un
-- override accordé, qui sert de témoin : ses droits doivent tomber avec lui.
INSERT INTO user_permission_overrides(user_profile_id, permission_code, is_granted, reason, granted_by)
SELECT f.profile_id, 'users.update', true, 'Deactivation fixture', s.profile_id
FROM deact_fixture f CROSS JOIN deact_fixture s
WHERE f.name IN ('admin','custom','cashier') AND s.name = 'super';
INSERT INTO role_permissions(role_code, permission_code, is_granted)
VALUES ('SUPER_ADMIN','users.update',true)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = true;
DELETE FROM role_permissions WHERE role_code = 'CASHIER' AND permission_code = 'users.update';

INSERT INTO user_sessions(user_id, session_token_hash, device_type, permissions_snapshot, session_timeout_minutes)
SELECT profile_id, 'deact-' || profile_id::text, 'backoffice', ARRAY['users.update'], 60
FROM deact_fixture WHERE name = 'cashier';

CREATE FUNCTION pg_temp.profile(p_name text) RETURNS uuid LANGUAGE sql AS
$$ SELECT profile_id FROM deact_fixture WHERE name = p_name $$;
CREATE FUNCTION pg_temp.uid(p_name text) RETURNS uuid LANGUAGE sql AS
$$ SELECT auth_id FROM deact_fixture WHERE name = p_name $$;
CREATE FUNCTION pg_temp.login(p_name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_uid uuid;
BEGIN
  SELECT auth_id INTO v_uid FROM deact_fixture WHERE name = p_name;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_uid,'role','authenticated')::text, true);
END $$;

-- Droits d'exécution.
SELECT ok(NOT has_function_privilege('anon','public.set_user_active_v1(uuid,boolean,text)','EXECUTE'), 'anon ne peut pas désactiver');
SELECT ok(has_function_privilege('authenticated','public.set_user_active_v1(uuid,boolean,text)','EXECUTE'), 'authenticated peut appeler');

-- 1. has_permission seule : le même profil, la même requête, actif puis inactif.
SELECT ok(has_permission(pg_temp.uid('cashier'),'users.update'), 'profil actif : droit accordé');
UPDATE user_profiles SET is_active = false WHERE id = pg_temp.profile('cashier');
SELECT ok(NOT has_permission(pg_temp.uid('cashier'),'users.update'), 'même profil désactivé : droit perdu');
UPDATE user_profiles SET is_active = true WHERE id = pg_temp.profile('cashier');
SELECT ok(has_permission(pg_temp.uid('cashier'),'users.update'), 'profil réactivé : droit rendu');

-- 2. Gardes du geste.
SELECT pg_temp.login('plain');
SELECT throws_ok($$ SELECT set_user_active_v1(pg_temp.profile('cashier'), false, 'left the company') $$,
  '42501', 'set_user_active_v1: missing permission users.update', 'sans users.update : refus');

SELECT pg_temp.login('admin');
SELECT throws_ok($$ SELECT set_user_active_v1(pg_temp.profile('super'), false, 'left the company') $$,
  '42501', 'super_admin_only', 'ADMIN ne désactive pas un SUPER_ADMIN');
SELECT throws_ok($$ SELECT set_user_active_v1(pg_temp.profile('admin'), false, 'left the company') $$,
  '42501', 'self_deactivation_forbidden', 'auto-désactivation refusée');
SELECT throws_ok($$ SELECT set_user_active_v1(pg_temp.profile('cashier'), false, ' x ') $$,
  '22023', 'set_user_active_v1: reason must be at least 3 chars', 'motif exigé');
SELECT throws_ok($$ SELECT set_user_active_v1(gen_random_uuid(), false, 'left the company') $$,
  'P0002', 'set_user_active_v1: user not found or deleted', 'cible inconnue');
SELECT is((SELECT count(*) FROM audit_logs WHERE entity_id IN (SELECT profile_id FROM deact_fixture)), 0::bigint,
  'aucune trace après des refus');

-- 3. Désactivation effective.
SELECT is(
  (SELECT set_user_active_v1(pg_temp.profile('cashier'), false, '  left the company  ')),
  jsonb_build_object('is_active', false, 'revoked_session_count', 1),
  'désactivation : une session coupée');
SELECT is((SELECT is_active FROM user_profiles WHERE id = pg_temp.profile('cashier')), false, 'profil inactif');
SELECT ok(NOT has_permission(pg_temp.uid('cashier'),'users.update'), 'droits coupés sans attendre le jeton');
SELECT is((SELECT count(*) FROM user_sessions WHERE user_id = pg_temp.profile('cashier') AND ended_at IS NULL), 0::bigint,
  'aucune session ouverte');
SELECT is((SELECT end_reason FROM user_sessions WHERE user_id = pg_temp.profile('cashier')), 'account_deactivated',
  'motif de fin de session');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE action = 'user.deactivate'
  AND actor_id = pg_temp.profile('admin') AND entity_id = pg_temp.profile('cashier')
  AND metadata->>'reason' = 'left the company' AND (metadata->>'revoked_session_count')::int = 1),
  'trace avec un actor_id de profil');

-- Le compte désactivé, avec son jeton encore en main, ne passe plus la garde.
SELECT pg_temp.login('cashier');
SELECT throws_ok($$ SELECT set_user_active_v1(pg_temp.profile('plain'), false, 'left the company') $$,
  '42501', 'set_user_active_v1: missing permission users.update', 'compte désactivé : refus serveur');

-- 4. Répétition sans effet, puis réactivation.
SELECT pg_temp.login('admin');
SELECT is((SELECT set_user_active_v1(pg_temp.profile('cashier'), false, 'left the company')->>'noop'), 'true', 'répétition : sans effet');
SELECT is((SELECT count(*) FROM audit_logs WHERE action = 'user.deactivate' AND entity_id = pg_temp.profile('cashier')), 1::bigint,
  'répétition : pas de seconde trace');
SELECT lives_ok($$ SELECT set_user_active_v1(pg_temp.profile('cashier'), true, 'came back') $$, 'réactivation');
SELECT ok(has_permission(pg_temp.uid('cashier'),'users.update'), 'droits rendus à la réactivation');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE action = 'user.reactivate'
  AND actor_id = pg_temp.profile('admin') AND entity_id = pg_temp.profile('cashier')), 'trace de réactivation');
SELECT is((SELECT count(*) FROM user_sessions WHERE user_id = pg_temp.profile('cashier') AND ended_at IS NULL), 0::bigint,
  'la réactivation ne rouvre aucune session');

-- 5. Dernier administrateur actif : un rôle personnalisé ne peut pas l'éteindre.
UPDATE user_profiles SET is_active = false
 WHERE role_code IN ('ADMIN','SUPER_ADMIN') AND deleted_at IS NULL AND id <> pg_temp.profile('admin');
SELECT pg_temp.login('custom');
SELECT throws_ok($$ SELECT set_user_active_v1(pg_temp.profile('admin'), false, 'left the company') $$,
  'P0001', 'LAST_ADMIN_PROTECTED: cannot deactivate the last remaining admin', 'dernier administrateur protégé');
SELECT is((SELECT is_active FROM user_profiles WHERE id = pg_temp.profile('admin')), true, 'administrateur resté actif');

SELECT * FROM finish();
ROLLBACK;
