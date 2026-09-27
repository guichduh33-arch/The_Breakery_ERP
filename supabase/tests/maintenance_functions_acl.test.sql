-- Exécution sur la répétition isolée ; aucune donnée conservée.
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
INSERT INTO stock_reservations(product_id,quantity,holder_type,expires_at)
SELECT product,1,'cart',now()-interval '1 hour' FROM maintenance_fixture
UNION ALL SELECT product,1,'cart',now()+interval '1 day' FROM maintenance_fixture;
-- Le refresh concurrent exige des vues déjà peuplées.
REFRESH MATERIALIZED VIEW public.mv_sales_daily;
REFRESH MATERIALIZED VIEW public.mv_pl_monthly;
CREATE FUNCTION pg_temp.maintenance_state() RETURNS jsonb LANGUAGE sql AS $state$
SELECT jsonb_build_object(
'reservations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.stock_reservations r),
'margins',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM public.margin_alerts r),
'audit_count',(SELECT count(*) FROM public.audit_logs),
'sales',(SELECT jsonb_agg(to_jsonb(r)) FROM public.mv_sales_daily r),
'pl',(SELECT jsonb_agg(to_jsonb(r)) FROM public.mv_pl_monthly r));
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
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('anon','public.refresh_mv_pl_monthly()','EXECUTE'),false,'refresh_mv_pl_monthly: anon ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('authenticated','public.refresh_mv_pl_monthly()','EXECUTE'),false,'refresh_mv_pl_monthly: authenticated ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('service_role','public.refresh_mv_pl_monthly()','EXECUTE'),true,'refresh_mv_pl_monthly: service_role ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('postgres','public.refresh_mv_pl_monthly()','EXECUTE'),true,'refresh_mv_pl_monthly: postgres ACL');
INSERT INTO maintenance_acl_results SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.refresh_mv_pl_monthly()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'refresh_mv_pl_monthly: PUBLIC denied');
SET LOCAL ROLE anon;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.refresh_mv_pl_monthly()','42501','permission denied for function refresh_mv_pl_monthly','refresh_mv_pl_monthly: anon call refused');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.refresh_mv_pl_monthly()','42501','permission denied for function refresh_mv_pl_monthly','refresh_mv_pl_monthly: authenticated call refused');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('anon','public.refresh_mv_sales_daily()','EXECUTE'),false,'refresh_mv_sales_daily: anon ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('authenticated','public.refresh_mv_sales_daily()','EXECUTE'),false,'refresh_mv_sales_daily: authenticated ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('service_role','public.refresh_mv_sales_daily()','EXECUTE'),true,'refresh_mv_sales_daily: service_role ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('postgres','public.refresh_mv_sales_daily()','EXECUTE'),true,'refresh_mv_sales_daily: postgres ACL');
INSERT INTO maintenance_acl_results SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.refresh_mv_sales_daily()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'refresh_mv_sales_daily: PUBLIC denied');
SET LOCAL ROLE anon;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.refresh_mv_sales_daily()','42501','permission denied for function refresh_mv_sales_daily','refresh_mv_sales_daily: anon call refused');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.refresh_mv_sales_daily()','42501','permission denied for function refresh_mv_sales_daily','refresh_mv_sales_daily: authenticated call refused');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('anon','public.release_expired_reservations()','EXECUTE'),false,'release_expired_reservations: anon ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('authenticated','public.release_expired_reservations()','EXECUTE'),false,'release_expired_reservations: authenticated ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('service_role','public.release_expired_reservations()','EXECUTE'),true,'release_expired_reservations: service_role ACL');
INSERT INTO maintenance_acl_results SELECT is(has_function_privilege('postgres','public.release_expired_reservations()','EXECUTE'),true,'release_expired_reservations: postgres ACL');
INSERT INTO maintenance_acl_results SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='public.release_expired_reservations()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'),'release_expired_reservations: PUBLIC denied');
SET LOCAL ROLE anon;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.release_expired_reservations()','42501','permission denied for function release_expired_reservations','release_expired_reservations: anon call refused');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO maintenance_acl_results SELECT throws_ok('SELECT public.release_expired_reservations()','42501','permission denied for function release_expired_reservations','release_expired_reservations: authenticated call refused');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is(pg_temp.maintenance_state(),(SELECT state FROM maintenance_before),'refused calls leave all observed state unchanged');
SET LOCAL ROLE service_role;
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.recompute_recipe_margins_v1()','recompute_recipe_margins_v1: service_role succeeds');
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.refresh_mv_pl_monthly()','refresh_mv_pl_monthly: service_role succeeds');
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.refresh_mv_sales_daily()','refresh_mv_sales_daily: service_role succeeds');
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.release_expired_reservations()','release_expired_reservations: service_role succeeds');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is((SELECT status FROM stock_reservations WHERE product_id=(SELECT product FROM maintenance_fixture) AND expires_at<now()),'released','service_role: expired reservation released');
INSERT INTO maintenance_acl_results SELECT is((SELECT status FROM stock_reservations WHERE product_id=(SELECT product FROM maintenance_fixture) AND expires_at>now()),'held','service_role: valid reservation retained');
INSERT INTO maintenance_acl_results SELECT is((SELECT expected_margin_pct FROM margin_alerts WHERE product_id=(SELECT product FROM maintenance_fixture) AND acknowledged_at IS NULL),20.00::numeric,'service_role: margin recalculated');
SET LOCAL ROLE postgres;
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.recompute_recipe_margins_v1()','recompute_recipe_margins_v1: postgres succeeds');
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.refresh_mv_pl_monthly()','refresh_mv_pl_monthly: postgres succeeds');
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.refresh_mv_sales_daily()','refresh_mv_sales_daily: postgres succeeds');
INSERT INTO maintenance_acl_results SELECT lives_ok('SELECT public.release_expired_reservations()','release_expired_reservations: postgres succeeds');
RESET ROLE;
INSERT INTO maintenance_acl_results SELECT is((SELECT status FROM stock_reservations WHERE product_id=(SELECT product FROM maintenance_fixture) AND expires_at<now()),'released','postgres: expired reservation released');
INSERT INTO maintenance_acl_results SELECT is((SELECT status FROM stock_reservations WHERE product_id=(SELECT product FROM maintenance_fixture) AND expires_at>now()),'held','postgres: valid reservation retained');
INSERT INTO maintenance_acl_results SELECT is((SELECT expected_margin_pct FROM margin_alerts WHERE product_id=(SELECT product FROM maintenance_fixture) AND acknowledged_at IS NULL),20.00::numeric,'postgres: margin recalculated');
INSERT INTO maintenance_acl_results SELECT * FROM finish();
SELECT line FROM maintenance_acl_results;
ROLLBACK;
