-- Inclure après BEGIN uniquement, sur répétition. Le fichier testé fait ROLLBACK.
-- Échec fermé si un identifiant canonique existe : aucun compte n'est remplacé.
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM auth.users WHERE id IN(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'))
 OR EXISTS(SELECT 1 FROM public.user_profiles WHERE employee_code IN('EMP000','EMP001','EMP002','EMP003')
 OR id IN('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',
 '00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004'))
 THEN RAISE EXCEPTION 'rehearsal_fixture_identity_conflict'; END IF;
END $guard$;
CREATE TEMP TABLE rehearsal_suite_actors(id uuid,employee_code text,role_code text,pin text);
INSERT INTO rehearsal_suite_actors VALUES
 ('00000000-0000-0000-0000-000000000001','EMP000','SUPER_ADMIN','123456'),
 ('00000000-0000-0000-0000-000000000002','EMP001','CASHIER','567890'),
 ('00000000-0000-0000-0000-000000000003','EMP002','ADMIN','567800'),
 ('00000000-0000-0000-0000-000000000004','EMP003','MANAGER','111111');
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
 SELECT id,id||'@pgtap-rehearsal.invalid','{"provider":"pin","providers":["pin"]}'::jsonb,
 '{"provider":"pin"}'::jsonb FROM rehearsal_suite_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,id,employee_code,'Transactional pgTAP fixture',public.hash_pin(pin),role_code,true
 FROM rehearsal_suite_actors;
-- Permission du scénario de création retail ; la matrice des rôles est préservée.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT id,'customers.pos.create',true,'Transactional retail fixture'
 FROM rehearsal_suite_actors WHERE role_code='CASHIER';
INSERT INTO public.customer_categories(name,slug,is_default)
 SELECT 'Transactional pgTAP default','pgtap-'||gen_random_uuid(),true
 WHERE NOT EXISTS(SELECT 1 FROM public.customer_categories WHERE is_default AND deleted_at IS NULL);
