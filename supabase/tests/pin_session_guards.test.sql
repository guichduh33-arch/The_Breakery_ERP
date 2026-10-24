BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
CREATE TEMP TABLE pin_fixture(profile_id uuid, auth_id uuid, session_id uuid, other_session_id uuid);
INSERT INTO pin_fixture VALUES(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
INSERT INTO auth.users(id) SELECT auth_id FROM pin_fixture;
INSERT INTO public.user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
SELECT profile_id,auth_id,'CASHIER','SESSION-' || left(profile_id::text,8),'Session guard fixture',hash_pin('285741'),true FROM pin_fixture;
INSERT INTO public.user_sessions(id,user_id,session_token_hash,device_type,permissions_snapshot,session_timeout_minutes)
SELECT session_id,profile_id,gen_random_uuid()::text,'pos',ARRAY[]::text[],30 FROM pin_fixture
UNION ALL SELECT other_session_id,profile_id,gen_random_uuid()::text,'backoffice',ARRAY['orders.read'],30 FROM pin_fixture;

SELECT ok(NOT has_function_privilege('anon','public.is_pin_session_active_v1(uuid,uuid)','execute'),'helper privé à anon/PUBLIC');
SELECT ok(NOT has_function_privilege('authenticated','public.is_pin_session_active_v1(uuid,uuid)','execute'),'pas de sonde de session authenticated');
SELECT ok(NOT has_function_privilege('authenticated','public.logout_user_session_v1(uuid,uuid)','execute'),'logout réservé au serveur');
SELECT ok(has_function_privilege('service_role','public.logout_user_session_v1(uuid,uuid)','execute'),'logout EF autorisé');
SELECT ok(is_pin_session_active_v1(session_id,auth_id),'snapshot vide valide') FROM pin_fixture;
SELECT ok(NOT is_pin_session_active_v1(session_id,gen_random_uuid()),'liaison au bon utilisateur obligatoire') FROM pin_fixture;
SELECT ok(NOT is_pin_session_active_v1(gen_random_uuid(),auth_id),'session inconnue refusée') FROM pin_fixture;

CREATE TEMP TABLE pin_claims(value jsonb);
INSERT INTO pin_claims SELECT jsonb_build_object('role','authenticated','sub',auth_id,'session_id',session_id,
  'exp',extract(epoch FROM now())+300,'app_metadata',jsonb_build_object('provider','pin')) FROM pin_fixture;
SELECT set_config('request.jwt.claims',(SELECT value::text FROM pin_claims),true);
SELECT ok(request_has_active_pin_session_v1(),'claims PIN liés acceptés');
SELECT set_config('request.jwt.claims',(SELECT (value-'session_id')::text FROM pin_claims),true);
SELECT ok(NOT request_has_active_pin_session_v1(),'ancien JWT sans session refusé');
SELECT set_config('request.jwt.claims',(SELECT jsonb_set(value,'{session_id}','"invalid"')::text FROM pin_claims),true);
SELECT ok(NOT request_has_active_pin_session_v1(),'UUID malformé refusé sans exception');
SELECT set_config('request.jwt.claims',(SELECT jsonb_set(value,'{app_metadata,provider}','"email"')::text FROM pin_claims),true);
SELECT ok(NOT request_has_active_pin_session_v1(),'session GoTrue seule refusée');
SELECT set_config('request.jwt.claims',(SELECT jsonb_set(value,'{exp}',to_jsonb(extract(epoch FROM now())))::text FROM pin_claims),true);
SELECT ok(NOT request_has_active_pin_session_v1(),'expiration à la limite refusée');
SELECT set_config('request.jwt.claims',(SELECT value::text FROM pin_claims),true);

UPDATE public.user_sessions SET last_activity_at=now()-interval '30 minutes' WHERE id=(SELECT session_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'inactivité exacte refusée');
UPDATE public.user_sessions SET last_activity_at=now(),created_at=now()-interval '24 hours' WHERE id=(SELECT session_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'âge maximal exact refusé');
UPDATE public.user_sessions SET created_at=now()+interval '1 second' WHERE id=(SELECT session_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'création future refusée');
UPDATE public.user_sessions SET created_at=now(),last_activity_at=now()+interval '1 second' WHERE id=(SELECT session_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'activité future refusée');
UPDATE public.user_sessions SET last_activity_at=now(),permissions_snapshot=ARRAY[NULL]::text[] WHERE id=(SELECT session_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'snapshot avec NULL refusé');
UPDATE public.user_sessions SET permissions_snapshot=ARRAY[['orders.read']] WHERE id=(SELECT session_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'snapshot multidimensionnel refusé sans exception');
UPDATE public.user_sessions SET permissions_snapshot=ARRAY[]::text[] WHERE id=(SELECT session_id FROM pin_fixture);
UPDATE public.user_profiles SET is_active=false WHERE id=(SELECT profile_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'profil désactivé refusé');
UPDATE public.user_profiles SET is_active=true,deleted_at=now() WHERE id=(SELECT profile_id FROM pin_fixture);
SELECT ok(NOT request_has_active_pin_session_v1(),'profil supprimé refusé');
UPDATE public.user_profiles SET deleted_at=NULL WHERE id=(SELECT profile_id FROM pin_fixture);
SELECT ok(request_has_active_pin_session_v1(),'profil rétabli et session inchangée');
SELECT is(last_activity_at,created_at,'la garde ne renouvelle pas la session') FROM public.user_sessions WHERE id=(SELECT session_id FROM pin_fixture);

SELECT ok(NOT logout_user_session_v1(session_id,gen_random_uuid()),'logout refuse le mauvais profil') FROM pin_fixture;
SELECT ok(logout_user_session_v1(session_id,profile_id),'logout de la seule session ciblée') FROM pin_fixture;
SELECT ok(logout_user_session_v1(session_id,profile_id),'reprise logout idempotente') FROM pin_fixture;
SELECT is((SELECT count(*) FROM public.audit_logs WHERE action='logout' AND entity_id=(SELECT session_id FROM pin_fixture)),1::bigint,'un seul audit');
SELECT ok(NOT request_has_active_pin_session_v1(),'ancien JWT signé immédiatement refusé après logout');
SELECT ok(is_pin_session_active_v1(other_session_id,auth_id),'autre session du profil conservée') FROM pin_fixture;

SELECT * FROM finish();
ROLLBACK;
