-- Exécution sur la répétition isolée ; aucune donnée conservée.
-- S2-03/S2-05 : les cas des réservations et des vues matérialisées ont été retirés avec leurs objets.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SET LOCAL statement_timeout = '60s';
CREATE TEMP TABLE maintenance_acl_results(line text);
GRANT INSERT ON maintenance_acl_results TO anon, authenticated, service_role;
INSERT INTO maintenance_acl_results SELECT no_plan();
CREATE TEMP TABLE maintenance_fixture AS SELECT gen_random_uuid() AS category, gen_random_uuid() AS product, gen_random_uuid() AS material;
INSERT INTO categories(id,name,slug) SELECT category,'Maintenance ACL test','maintenance-acl-'||category::text FROM maintenance_fixture;
INSERT INTO products(id,sku,name,category_id,retail_price,unit,cost_price,product_type,target_gross_margin_pct)
SELECT product,'MA-ACL-'||product::text,'Maintenance ACL product',category,10000,'pcs',0,'finished',60 FROM maintenance_fixture;
INSERT INTO products(id,sku,name,category_id,retail_price,unit,cost_price,product_type)
SELECT material,'MA-ACL-'||material::text,'Maintenance ACL material',category,0,'kg',8000,'finished' FROM maintenance_fixture;
INSERT INTO recipes(product_id,material_id,quantity,unit,is_active)
SELECT product,material,1,'kg',true FROM maintenance_fixture;
CREATE FUNCTION pg_temp.maintenance_state() RETURNS jsonb LANGUAGE sql AS $state$
SELECT jsonb_build_object(
'margins',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.margin_alerts r),
'audit_count',(SELECT count(*) FROM public.audit_logs));
$state$;
CREATE TEMP TABLE maintenance_before AS SELECT pg_temp.maintenance_state() AS state;
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('anon','public.recompute_recipe_margins_v1()','EXECUTE'),false,'recompute_recipe_margins_v1: anon ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('authenticated','public.recompute_recipe_margins_v1()','EXECUTE'),false,'recompute_recipe_margins_v1: authenticated ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('service_role','public.recompute_recipe_margins_v1()','EXECUTE'),true,'recompute_recipe_margins_v1: service_role ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('postgres','public.recompute_recipe_margins_v1()','EXECUTE'),true,'recompute_recipe_margins_v1: postgres ACL');
INSERT INTO maintenance_acl_results SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.recompute_recipe_margins_v1()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'recompute_recipe_margins_v1: PUBLIC denied');
SET LOCAL ROLE anon;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.recompute_recipe_margins_v1()','42501','permission denied for function recompute_recipe_margins_v1','recompute_recipe_margins_v1: anon call refused');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.recompute_recipe_margins_v1()','42501','permission denied for function recompute_recipe_margins_v1','recompute_recipe_margins_v1: authenticated call refused');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is(pg_temp.maintenance_state(),(SELECT state FROM maintenance_before),'refused calls leave all observed state unchanged');
SET LOCAL ROLE service_role;
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.recompute_recipe_margins_v1()','recompute_recipe_margins_v1: service_role succeeds');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is((SELECT expected_margin_pct FROM margin_alerts WHERE product_id=(SELECT product FROM maintenance_fixture) AND acknowledged_at IS NULL),20.00::numeric,'service_role: margin recalculated');
SET LOCAL ROLE postgres;
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.recompute_recipe_margins_v1()','recompute_recipe_margins_v1: postgres succeeds');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is((SELECT expected_margin_pct FROM margin_alerts WHERE product_id=(SELECT product FROM maintenance_fixture) AND acknowledged_at IS NULL),20.00::numeric,'postgres: margin recalculated');
INSERT INTO maintenance_acl_results SELECT * FROM finish();
SELECT line FROM maintenance_acl_results;
ROLLBACK;
