-- S1-08, paquet 1 (ADR-039) : les tables confidentielles se lisent par permission.
-- Les comptes, dérogations et lignes de ce test disparaissent avec le ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE vis_results(seq serial,tap text);
CREATE TEMP TABLE vis_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('CASHIER')) r(role_code);
INSERT INTO auth.users(id,email) SELECT auth_user_id,auth_user_id||'@s108.invalid' FROM vis_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'S108-'||id,'S1-08 fixture','invalid-test-hash',role_code,true FROM vis_actors;
-- Le délégué : toutes les permissions, sauf les trois sous test, refusées par dérogation.
-- Une dérogation refusée l'emporte sur le rôle : le test ne dépend pas de la matrice vivante.
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,
  p.code NOT IN('reports.inventory.read','reports.audit.read','reports.statements.read'),
  'S1-08 visibility coverage'
 FROM vis_actors a CROSS JOIN public.permissions p WHERE a.role_code='CASHIER'
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=EXCLUDED.is_granted,expires_at=NULL;
-- Le propriétaire du test détient les trois permissions, quelle que soit la matrice vivante.
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
 SELECT 'SUPER_ADMIN',c,true FROM unnest(ARRAY['reports.inventory.read','reports.audit.read','reports.statements.read']) c
 ON CONFLICT(role_code,permission_code) DO UPDATE SET is_granted=true;
GRANT ALL ON vis_results TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE vis_results_seq_seq TO authenticated;

-- Une ligne connue dans chacune des deux tables lues ci-dessous.
CREATE TEMP TABLE vis_ids AS SELECT gen_random_uuid() product_id,gen_random_uuid() audit_entity;
GRANT SELECT ON vis_ids TO authenticated;
INSERT INTO public.products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit)
 SELECT product_id,'S108-'||product_id,'S1-08 product',(SELECT id FROM public.categories LIMIT 1),1000,100,0,'pcs'
 FROM vis_ids;
SELECT public.record_stock_movement_v2(p_product_id:=(SELECT product_id FROM vis_ids),
 p_movement_type:='incoming',p_quantity:=1,p_reason:='S1-08 fixture');
INSERT INTO public.audit_logs(action,entity_type,entity_id,metadata)
 SELECT 's108.fixture','products',audit_entity,'{}'::jsonb FROM vis_ids;

-- Catalogue et droits.
INSERT INTO vis_results(tap) SELECT ok(EXISTS(SELECT 1 FROM public.permissions WHERE code='reports.statements.read'),
 'reports.statements.read is in the catalogue');
INSERT INTO vis_results(tap) SELECT ok(EXISTS(SELECT 1 FROM public.role_permissions
 WHERE role_code='SUPER_ADMIN' AND permission_code='reports.statements.read' AND is_granted),
 'SUPER_ADMIN holds reports.statements.read');
INSERT INTO vis_results(tap) SELECT ok(NOT has_function_privilege('anon','public.can_view_stock_v2()','EXECUTE'),
 'anon cannot execute can_view_stock_v2');
INSERT INTO vis_results(tap) SELECT ok(NOT has_function_privilege('anon','public.can_view_statements_v1()','EXECUTE'),
 'anon cannot execute can_view_statements_v1');

-- Les huit règles restent restrictives et évaluent leur fonction une fois par requête.
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM pg_policies
 WHERE permissive='RESTRICTIVE' AND cmd='SELECT' AND qual ~ '^\(\s*SELECT\s' AND (
  (policyname IN('confidentiality_stock_movements','confidentiality_display_stock',
    'confidentiality_display_movements','count_items_owner_only') AND qual ~ 'can_view_stock_v2\(\)')
  OR (policyname IN('confidentiality_audit_logs','confidentiality_pos_events','confidentiality_notifications')
    AND qual ~ 'has_permission\(auth\.uid\(\), ''reports\.audit\.read''')
  OR (policyname='confidentiality_zreports' AND qual ~ 'can_view_statements_v1\(\)'))),
 8::bigint,'The eight confidential policies read a permission through an InitPlan');
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM pg_policies
 WHERE qual ~ 'is_business_owner_v1|can_view_business_day_v2' AND policyname IN(
  'confidentiality_stock_movements','confidentiality_display_stock','confidentiality_display_movements',
  'count_items_owner_only','confidentiality_audit_logs','confidentiality_pos_events',
  'confidentiality_notifications','confidentiality_zreports')),0::bigint,
 'No confidential policy keeps the hard-coded owner test');
INSERT INTO vis_results(tap) SELECT ok((SELECT qual FROM pg_policies
 WHERE tablename='audit_logs' AND policyname='admin_read') ~ 'reports\.audit\.read'
 AND (SELECT qual FROM pg_policies WHERE tablename='audit_logs' AND policyname='admin_read') !~ 'get_current_role',
 'The audit-log read policy reads the permission, not the role');

-- Délégué sans les permissions : rien.
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM vis_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO vis_results(tap) SELECT ok(NOT public.can_view_stock_v2() AND NOT public.can_view_statements_v1(),
 'A delegate without the permissions sees neither stock nor statements');
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM public.stock_movements
 WHERE product_id=(SELECT product_id FROM vis_ids)),0::bigint,'Stock movements hidden without reports.inventory.read');
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM public.audit_logs
 WHERE entity_id=(SELECT audit_entity FROM vis_ids)),0::bigint,'Audit logs hidden without reports.audit.read');
RESET ROLE;

-- Délégation du stock seul : le stock s'ouvre, les journaux et les états restent fermés.
UPDATE public.user_permission_overrides SET is_granted=true
 WHERE user_profile_id=(SELECT id FROM vis_actors WHERE role_code='CASHIER') AND permission_code='reports.inventory.read';
SET LOCAL ROLE authenticated;
INSERT INTO vis_results(tap) SELECT ok(public.can_view_stock_v2(),'reports.inventory.read delegates stock visibility');
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM public.stock_movements
 WHERE product_id=(SELECT product_id FROM vis_ids)),1::bigint,'The delegate reads the stock movement');
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM public.audit_logs
 WHERE entity_id=(SELECT audit_entity FROM vis_ids)),0::bigint,'Stock delegation does not open the audit logs');
INSERT INTO vis_results(tap) SELECT ok(NOT public.can_view_statements_v1(),'Stock delegation does not open the statements');
RESET ROLE;

-- Délégation des journaux et des états.
UPDATE public.user_permission_overrides SET is_granted=true
 WHERE user_profile_id=(SELECT id FROM vis_actors WHERE role_code='CASHIER')
  AND permission_code IN('reports.audit.read','reports.statements.read');
SET LOCAL ROLE authenticated;
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM public.audit_logs
 WHERE entity_id=(SELECT audit_entity FROM vis_ids)),1::bigint,'reports.audit.read opens the audit logs');
INSERT INTO vis_results(tap) SELECT ok(public.can_view_statements_v1(),'reports.statements.read delegates statements visibility');
RESET ROLE;

-- Le propriétaire garde tout.
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM vis_actors WHERE role_code='SUPER_ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO vis_results(tap) SELECT ok(public.can_view_stock_v2() AND public.can_view_statements_v1(),
 'The owner keeps stock and statements visibility');
INSERT INTO vis_results(tap) SELECT is((SELECT count(*) FROM public.stock_movements
 WHERE product_id=(SELECT product_id FROM vis_ids)),1::bigint,'The owner reads the stock movement');
RESET ROLE;

SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM vis_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
