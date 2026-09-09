-- Fixtures dédiées, à exécuter après la migration de snapshot des sessions.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE session_fixture(profile_id uuid, auth_id uuid);
INSERT INTO session_fixture VALUES (gen_random_uuid(), gen_random_uuid());
INSERT INTO auth.users(id) SELECT auth_id FROM session_fixture;
INSERT INTO user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
SELECT profile_id,auth_id,'CASHIER','AUDIT-' || left(profile_id::text,8),'Audit session',hash_pin('285741'),true FROM session_fixture;
CREATE TEMP TABLE session_cases(name text, id uuid);
INSERT INTO session_cases SELECT name, gen_random_uuid()
FROM unnest(ARRAY['five','thirty','hundred_twenty','expired_idle','expired_day','legacy','ended']) name;
INSERT INTO user_sessions(id,user_id,session_token_hash,device_type,created_at,last_activity_at,permissions_snapshot,session_timeout_minutes,ended_at)
SELECT c.id,f.profile_id,gen_random_uuid()::text,'pos',
  CASE WHEN c.name='expired_day' THEN now()-interval '24 hours' ELSE now()-interval '2 hours' END,
  CASE WHEN c.name='expired_idle' THEN now()-interval '30 minutes' ELSE now()-interval '1 minute' END,
  CASE WHEN c.name='legacy' THEN NULL ELSE ARRAY['orders.read'] END,
  CASE c.name WHEN 'five' THEN 5 WHEN 'hundred_twenty' THEN 120 ELSE 30 END,
  CASE WHEN c.name='ended' THEN now() END
FROM session_cases c CROSS JOIN session_fixture f;
SELECT ok(NOT has_function_privilege('anon','public.touch_user_session_v1(uuid)','EXECUTE'),'anon et PUBLIC exclus');
SELECT ok(NOT has_function_privilege('authenticated','public.touch_user_session_v1(uuid)','EXECUTE'),'appel direct authenticated interdit');
SELECT ok(has_function_privilege('service_role','public.touch_user_session_v1(uuid)','EXECUTE'),'EF service autorisée');
SELECT ok(touch_user_session_v1(id),'session active ' || name) FROM session_cases WHERE name IN ('five','thirty','hundred_twenty');
SELECT ok(NOT touch_user_session_v1(id),'session non renouvelable ' || name) FROM session_cases WHERE name IN ('expired_idle','expired_day','legacy','ended');
SELECT is(permissions_snapshot,ARRAY['orders.read'],'snapshot inchangé') FROM user_sessions WHERE id=(SELECT id FROM session_cases WHERE name='five');
SELECT is(last_activity_at,now(),'activité écrite') FROM user_sessions WHERE id=(SELECT id FROM session_cases WHERE name='five');
UPDATE user_profiles SET is_active=false WHERE id=(SELECT profile_id FROM session_fixture);
SELECT ok(NOT touch_user_session_v1(id),'profil désactivé refusé') FROM session_cases WHERE name='five';
UPDATE user_profiles SET is_active=true,deleted_at=now() WHERE id=(SELECT profile_id FROM session_fixture);
SELECT ok(NOT touch_user_session_v1(id),'profil supprimé refusé') FROM session_cases WHERE name='five';
SELECT * FROM finish();
ROLLBACK;
