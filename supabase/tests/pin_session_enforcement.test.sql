BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT no_plan();
SELECT is((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity
    AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
      AND p.polname='pin_session_required' AND NOT p.polpermissive)),0::bigint,'toutes les tables publiques RLS gardées');
SELECT is((SELECT count(*) FROM pg_policies WHERE schemaname IN ('storage','realtime')
  AND tablename IN ('objects','messages') AND policyname='pin_session_required'
  AND permissive='RESTRICTIVE' AND cmd='ALL'),2::bigint,'Storage et Realtime privés gardés');
SELECT ok(EXISTS(SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole,
  unnest(s.setconfig) config WHERE r.rolname='authenticator'
  AND config='pgrst.db_pre_request=public.enforce_pin_session_v2'),'pre-request activé');
SELECT ok(NOT has_table_privilege('authenticated','public.stock_movements','UPDATE'),'ledger stock reste append-only');
SELECT ok(NOT has_table_privilege('authenticated','public.stock_movements','DELETE'),'ledger stock reste sans suppression');
SELECT ok((SELECT pubinsert AND pubupdate AND NOT pubdelete AND NOT pubtruncate FROM pg_publication WHERE pubname='supabase_realtime'),'publication sans DELETE ni TRUNCATE');
SELECT is((SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='ui_invalidation_topics'),2::bigint,'signal limité au topic et à la révision');
SELECT ok(NOT has_table_privilege('authenticated','public.ui_invalidation_topics','UPDATE'),'signal non modifiable par le client');
SELECT ok(NOT has_function_privilege('authenticated','public.signal_ui_invalidation_v1()','EXECUTE'),'trigger non appelable directement');
CREATE TEMP TABLE signal_before AS SELECT * FROM public.ui_invalidation_topics;
UPDATE public.products SET current_stock=current_stock WHERE false;
UPDATE public.categories SET name=name WHERE false;
SELECT is((SELECT revision FROM public.ui_invalidation_topics WHERE topic='catalog'),
  (SELECT revision FROM signal_before WHERE topic='catalog'),'UPDATE stock/catalogue sans signal partagé');
SELECT is((SELECT count(*) FROM pg_trigger WHERE tgname='invalidate_catalog'
  AND tgrelid IN ('public.products'::regclass,'public.categories'::regclass)
  AND NOT tgisinternal AND tgtype=40),2::bigint,'signaux catalogue limités à DELETE/TRUNCATE par instruction');
SELECT is((SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'
  AND schemaname='public' AND tablename IN ('products','categories')),2::bigint,'INSERT/UPDATE catalogue restent publiés directement');
DELETE FROM public.products WHERE false;
SELECT isnt((SELECT revision FROM public.ui_invalidation_topics WHERE topic='catalog'),
  (SELECT revision FROM signal_before WHERE topic='catalog'),'suppression produit invalide le catalogue');
UPDATE signal_before SET revision=(SELECT revision FROM public.ui_invalidation_topics WHERE topic='catalog') WHERE topic='catalog';
DELETE FROM public.categories WHERE false;
DELETE FROM public.receipt_templates WHERE false;
DELETE FROM public.orders WHERE false;
SELECT isnt(t.revision,b.revision,'invalidation sans identifiant métier : ' || t.topic)
FROM public.ui_invalidation_topics t JOIN signal_before b USING(topic);
CREATE TEMP TABLE active_session_fixture(profile_id uuid, auth_id uuid, session_id uuid);
INSERT INTO active_session_fixture VALUES(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
INSERT INTO auth.users(id) SELECT auth_id FROM active_session_fixture;
INSERT INTO public.user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
SELECT profile_id,auth_id,'CASHIER','SIGNAL-'||left(profile_id::text,8),'Private signal fixture',hash_pin('285741'),true FROM active_session_fixture;
INSERT INTO public.user_sessions(id,user_id,session_token_hash,device_type,permissions_snapshot,session_timeout_minutes)
SELECT session_id,profile_id,gen_random_uuid()::text,'pos',ARRAY['orders.read'],30 FROM active_session_fixture;
SELECT set_config('request.jwt.claims',(SELECT jsonb_build_object('role','authenticated','sub',auth_id,'session_id',session_id,
  'exp',extract(epoch FROM now())+300,'app_metadata',jsonb_build_object('provider','pin'))::text FROM active_session_fixture),true);
SET LOCAL ROLE authenticated;
SELECT lives_ok('SELECT public.enforce_pin_session_v2()','session valide avant logout');
SELECT is((SELECT count(*) FROM public.ui_invalidation_topics),3::bigint,'trois signaux privés sous session active');
RESET ROLE;
SELECT ok(logout_user_session_v1(session_id,profile_id),'révocation confirmée') FROM active_session_fixture;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*) FROM public.ui_invalidation_topics),0::bigint,'même JWT révoqué ne lit plus les signaux');
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"authenticated","sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT public.enforce_pin_session_v2()','PT401','session_expired','RPC sans session bloquée');
SELECT is((SELECT count(*) FROM public.user_profiles),0::bigint,'lecture privée sans session bloquée par RLS');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT lives_ok('SELECT public.enforce_pin_session_v2()','picker public non bloqué par pre-request');
RESET ROLE;
SET LOCAL ROLE kiosk_display;
SELECT lives_ok('SELECT public.enforce_pin_session_v2()','appareil garde son gate dédié');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok('SELECT public.enforce_pin_session_v2()','serveur garde ses contrats');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
