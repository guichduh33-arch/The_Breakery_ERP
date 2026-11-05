BEGIN;
SELECT no_plan();
CREATE TEMP TABLE dashboard_security_results(result text);
DO $fixture$
DECLARE v_auth uuid; v_product uuid;
BEGIN
 SELECT auth_user_id INTO STRICT v_auth FROM public.user_profiles
 WHERE deleted_at IS NULL AND is_active AND role_code='SUPER_ADMIN' AND auth_user_id IS NOT NULL LIMIT 1;
 SELECT id INTO STRICT v_product FROM public.products WHERE deleted_at IS NULL LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_auth::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_auth)::text,true);
 PERFORM set_config('dashboard.product',v_product::text,true);
END $fixture$;
GRANT INSERT,SELECT ON dashboard_security_results TO authenticated;
SET LOCAL ROLE authenticated;
INSERT INTO dashboard_security_results SELECT lives_ok(format('SELECT public.get_product_dashboard_v7(%L,30)',
 current_setting('dashboard.product')),'authenticated inventory reader can use the private recognized-sales projection');
RESET ROLE;
INSERT INTO dashboard_security_results SELECT ok(NOT has_function_privilege('anon',
 'public.get_product_dashboard_v7(uuid,integer)','EXECUTE'),'anonymous reader denied');
INSERT INTO dashboard_security_results SELECT ok(NOT has_schema_privilege('authenticated','reporting_private','USAGE'),
 'private reporting schema remains private');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
INSERT INTO dashboard_security_results SELECT throws_ok(format('SELECT public.get_product_dashboard_v7(%L,30)',
 current_setting('dashboard.product')),'P0003','stock_visibility_owner_required','stock reader requires an Owner identity');
INSERT INTO dashboard_security_results SELECT * FROM finish();
SELECT jsonb_agg(result) FROM dashboard_security_results;
ROLLBACK;
