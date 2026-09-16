-- Fixtures dédiées ; aucune hypothèse sur la matrice de permissions seedée.
-- À exécuter après les migrations du lot 1, dans cette transaction annulée.
BEGIN;
SELECT no_plan();

CREATE TEMP TABLE identity_fixture(name text PRIMARY KEY, profile_id uuid, auth_id uuid);
INSERT INTO identity_fixture SELECT name, gen_random_uuid(), gen_random_uuid()
FROM unnest(ARRAY['super','admin','custom','cashier','inactive','deleted','missing']) name;
INSERT INTO auth.users(id) SELECT auth_id FROM identity_fixture;
INSERT INTO roles(code, name, is_system) VALUES ('AUDIT_IDENTITY_TEST', 'Audit identity test', false);
INSERT INTO user_profiles(id, auth_user_id, role_code, employee_code, full_name, pin_hash, is_active, deleted_at)
SELECT profile_id, auth_id,
  CASE name WHEN 'super' THEN 'SUPER_ADMIN' WHEN 'admin' THEN 'ADMIN'
    WHEN 'custom' THEN 'AUDIT_IDENTITY_TEST' ELSE 'CASHIER' END,
  'AUDIT-' || left(profile_id::text, 8), 'Audit ' || name, hash_pin('285741'),
  name <> 'inactive', CASE WHEN name = 'deleted' THEN now() END
FROM identity_fixture WHERE name <> 'missing';
INSERT INTO user_permission_overrides(user_profile_id, permission_code, is_granted, reason, granted_by)
SELECT f.profile_id, p, true, 'Audit identity fixture', s.profile_id
FROM identity_fixture f CROSS JOIN identity_fixture s
CROSS JOIN unnest(ARRAY['users.update','users.create']) p
WHERE f.name IN ('admin','custom','inactive','deleted') AND s.name = 'super';
-- SUPER_ADMIN est protégé des overrides : épingler ses grants dans la transaction.
INSERT INTO role_permissions(role_code, permission_code, is_granted)
VALUES ('SUPER_ADMIN','users.update',true), ('SUPER_ADMIN','users.create',true)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = true;

CREATE FUNCTION pg_temp.profile(p_name text) RETURNS uuid LANGUAGE sql AS
$$ SELECT profile_id FROM identity_fixture WHERE name = p_name $$;
CREATE FUNCTION pg_temp.login(p_name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_uid uuid;
BEGIN
  SELECT auth_id INTO v_uid FROM identity_fixture WHERE name = p_name;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',v_uid,'role','authenticated')::text, true);
END $$;

SELECT ok(NOT has_function_privilege('anon','public.reset_user_pin_v2(uuid,text)','EXECUTE'), 'anon reset interdit');
SELECT ok(NOT has_function_privilege('authenticated','public.change_user_pin_v1(uuid,uuid,text,text)','EXECUTE'), 'helper EF inaccessible à authenticated');
SELECT ok(NOT has_function_privilege('anon','public.change_user_pin_v1(uuid,uuid,text,text)','EXECUTE'), 'helper EF inaccessible à anon/PUBLIC');
SELECT ok(has_function_privilege('service_role','public.change_user_pin_v1(uuid,uuid,text,text)','EXECUTE'), 'service EF autorisé');
SELECT ok(to_regprocedure('public.reset_user_pin_v1(uuid,text)') IS NULL, 'ancienne voie de reset supprimée');

SELECT pg_temp.login('admin');
SELECT throws_ok($$ SELECT update_user_role_v2(pg_temp.profile('admin'),'SUPER_ADMIN','audit promotion') $$,
  '42501','super_admin_only','auto-promotion ADMIN refusée');
SELECT throws_ok($$ SELECT create_user_v2('AUDIT-ESCALATE','Audit escalation','SUPER_ADMIN','285741') $$,
  '42501','super_admin_only','création SUPER_ADMIN par ADMIN refusée');
SELECT throws_ok($$ SELECT update_user_role_v2(pg_temp.profile('super'),'CASHIER','audit demotion') $$,
  '42501','super_admin_only','retrait SUPER_ADMIN par ADMIN refusé');
SELECT throws_ok($$ SELECT delete_user_v2(pg_temp.profile('super'),'audit delete') $$,
  '42501','super_admin_only','suppression SUPER_ADMIN par ADMIN refusée');
SELECT throws_ok($$ SELECT update_user_profile_v2(pg_temp.profile('super'),'Changed','CHANGED') $$,
  '42501','super_admin_only','édition SUPER_ADMIN par ADMIN refusée');
SELECT throws_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('super'),'936027') $$,
  '42501','super_admin_only','reset SUPER_ADMIN par ADMIN refusé');
SELECT throws_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('admin'),'936027') $$,
  '42501','self_reset_forbidden_use_pin_change','self-reset ADMIN refusé malgré users.update');
SELECT is((SELECT role_code FROM user_profiles WHERE id=pg_temp.profile('admin')), 'ADMIN','rôle inchangé après refus');
SELECT ok(verify_user_pin(pg_temp.profile('super'),'285741'),'PIN cible inchangé après refus');
SELECT is((SELECT count(*) FROM audit_logs WHERE entity_id IN (SELECT profile_id FROM identity_fixture)),0::bigint,'aucune fausse trace de succès');

SELECT pg_temp.login('custom');
SELECT lives_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('cashier'),'936027') $$,'rôle personnalisé avec permission peut reset');
SELECT ok(verify_user_pin(pg_temp.profile('cashier'),'936027'),'reset autorisé effectif');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE actor_id=pg_temp.profile('custom')
  AND entity_id=pg_temp.profile('cashier') AND action='pin.change_admin'),'audit avec id profil');
SELECT lives_ok($$ SELECT update_user_role_v2(pg_temp.profile('cashier'),'MANAGER','audit role') $$,'rôle personnalisé peut changer rôle ordinaire');
SELECT throws_ok($$ SELECT update_user_role_v2(pg_temp.profile('custom'),'SUPER_ADMIN','audit promotion') $$,
  '42501','super_admin_only','rôle personnalisé ne peut devenir SUPER_ADMIN');

UPDATE user_permission_overrides SET is_granted=false
WHERE user_profile_id=pg_temp.profile('admin') AND permission_code='users.update';
SELECT pg_temp.login('admin');
SELECT throws_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('cashier'),'111222') $$,
  '42501','permission_denied','DENY ADMIN prévaut au reset public');
SELECT is(change_user_pin_v1(pg_temp.profile('admin'),pg_temp.profile('cashier'),'111222')->>'error',
  'permission_denied','DENY ADMIN prévaut au chemin EF');
SELECT throws_ok($$ SELECT update_user_role_v2(pg_temp.profile('cashier'),'CASHIER','audit deny') $$,
  '42501',NULL,'DENY ADMIN prévaut au changement de rôle');
SELECT ok(verify_user_pin(pg_temp.profile('cashier'),'936027'),'DENY ne change pas le PIN');

SELECT pg_temp.login('cashier');
SELECT throws_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('cashier'),'111222') $$,
  '42501','self_reset_forbidden_use_pin_change','self-reset ordinaire refusé');
SELECT is(change_user_pin_v1(pg_temp.profile('cashier'),pg_temp.profile('cashier'),'285741')->>'error',
  'current_pin_required','changement personnel exige PIN courant');
SELECT is(change_user_pin_v1(pg_temp.profile('cashier'),pg_temp.profile('cashier'),'285741','000000')->>'error',
  'invalid_current_pin','mauvais PIN refusé');
SELECT is((SELECT failed_login_attempts FROM user_profiles WHERE id=pg_temp.profile('cashier')),1,'échec PIN conservé');
SELECT ok(verify_user_pin(pg_temp.profile('cashier'),'936027'),'mauvais PIN ne mute pas le PIN');
SELECT change_user_pin_v1(pg_temp.profile('cashier'),pg_temp.profile('cashier'),'285741','000000') FROM generate_series(1,4);
SELECT ok((SELECT locked_until > now() FROM user_profiles WHERE id=pg_temp.profile('cashier')),'cinq échecs verrouillent le compte');
SELECT is(change_user_pin_v1(pg_temp.profile('cashier'),pg_temp.profile('cashier'),'285741','936027')->>'error',
  'account_locked','PIN correct ne contourne pas le verrouillage');
UPDATE user_profiles SET locked_until=now()-interval '1 second' WHERE id=pg_temp.profile('cashier');
SELECT is(change_user_pin_v1(pg_temp.profile('cashier'),pg_temp.profile('cashier'),'285741','936027')->>'ok','true','changement personnel autorisé après expiration');
SELECT ok(verify_user_pin(pg_temp.profile('cashier'),'285741'),'nouveau PIN personnel effectif');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE actor_id=pg_temp.profile('cashier')
  AND entity_id=pg_temp.profile('cashier') AND action='pin.change_self'),'audit personnel correct');

-- Aucun NULL de comparaison ne doit ouvrir un chemin self/admin.
SELECT pg_temp.login('missing');
SELECT throws_ok($$ SELECT update_user_profile_v2(pg_temp.profile('cashier'),'Forged','FORGED') $$,
  '42501','active_profile_required','profil absent : édition refusée');
SELECT throws_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('cashier'),'111222') $$,
  '42501','active_profile_required','profil absent : reset refusé');
SELECT pg_temp.login('deleted');
SELECT throws_ok($$ SELECT update_user_profile_v2(pg_temp.profile('cashier'),'Forged','FORGED') $$,
  '42501','active_profile_required','profil supprimé : édition refusée');
SELECT throws_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('cashier'),'111222') $$,
  '42501','active_profile_required','profil supprimé : reset refusé');
SELECT pg_temp.login('inactive');
SELECT throws_ok($$ SELECT update_user_profile_v2(pg_temp.profile('cashier'),'Forged','FORGED') $$,
  '42501','active_profile_required','profil inactif : édition refusée');
SELECT throws_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('cashier'),'111222') $$,
  '42501','active_profile_required','profil inactif : reset refusé');
SELECT throws_ok($$ SELECT update_user_role_v2(pg_temp.profile('cashier'),'CASHIER','audit inactive') $$,
  '42501','active_profile_required','profil inactif : rôle refusé');
SELECT throws_ok($$ SELECT create_user_v2('AUDIT-INACTIVE','Audit inactive','CASHIER','285741') $$,
  '42501','active_profile_required','profil inactif : création refusée');
SELECT is(change_user_pin_v1(profile_id,pg_temp.profile('cashier'),'111222')->>'error',
  'active_profile_required','chemin EF refuse ' || name)
FROM identity_fixture WHERE name IN ('missing','deleted','inactive');

SELECT pg_temp.login('super');
SELECT lives_ok($$ SELECT update_user_role_v2(pg_temp.profile('custom'),'SUPER_ADMIN','audit authorized') $$,'SUPER_ADMIN peut attribuer SUPER_ADMIN');
SELECT lives_ok($$ SELECT reset_user_pin_v2(pg_temp.profile('custom'),'936027') $$,'SUPER_ADMIN peut reset un autre SUPER_ADMIN');
SELECT lives_ok($$ SELECT update_user_role_v2(pg_temp.profile('custom'),'CASHIER','audit authorized') $$,'SUPER_ADMIN peut retirer SUPER_ADMIN');

SELECT * FROM finish();
ROLLBACK;
