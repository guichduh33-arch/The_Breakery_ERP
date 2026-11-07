-- Aucun changement persistant : identités, sessions et overrides sont transactionnels.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE financial_report_actors AS
 SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('ADMIN'),('MANAGER'),('CASHIER')) r(role_code);
INSERT INTO auth.users(id,email)
 SELECT auth_user_id,auth_user_id||'@financial-report.invalid' FROM financial_report_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'FIN-'||id,'Financial report fixture','invalid-test-hash',role_code,true
 FROM financial_report_actors;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,true,'Transactional financial report coverage'
 FROM financial_report_actors a CROSS JOIN public.permissions p WHERE a.role_code<>'SUPER_ADMIN';
CREATE TEMP TABLE financial_report_results(seq serial,tap text);
GRANT ALL ON financial_report_results TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE financial_report_results_seq_seq TO authenticated;
GRANT SELECT ON financial_report_actors TO authenticated;

-- Utiliser une date historique : la clôture ne doit pas suffire à contourner l'Owner.
DO $test$
DECLARE v_actor record; v_call text;
BEGIN
 FOR v_actor IN SELECT * FROM financial_report_actors WHERE role_code<>'SUPER_ADMIN' LOOP
  PERFORM pg_temp.authenticate_pin(v_actor.auth_user_id);
  SET LOCAL ROLE authenticated;
  INSERT INTO financial_report_results(tap)
   SELECT ok(public.has_permission(v_actor.auth_user_id,'reports.financial.read'),
     v_actor.role_code||' has explicit financial permission');
  FOREACH v_call IN ARRAY ARRAY[
   'public.get_gross_margin_by_product_v5(''2000-01-01'',''2000-01-01'')',
   'public.get_payments_by_method_v5(''2000-01-01'',''2000-01-01'')',
   'public.get_pb1_report_v6(1,2000)',
   'public.calculate_pb1_payable_v5(''2000-01-01'',''2000-01-01'')'
  ] LOOP
   INSERT INTO financial_report_results(tap) SELECT throws_ok('SELECT '||v_call,
    '42501','financial_reports_owner_required',v_actor.role_code||' denied: '||v_call);
  END LOOP;
  RESET ROLE;
 END LOOP;
END $test$;

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM financial_report_actors WHERE role_code='SUPER_ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO financial_report_results(tap) SELECT lives_ok(
 'SELECT public.get_gross_margin_by_product_v5(''2000-01-01'',''2000-01-01'')','Owner reads gross margin');
INSERT INTO financial_report_results(tap) SELECT lives_ok(
 'SELECT public.get_payments_by_method_v5(''2000-01-01'',''2000-01-01'')','Owner reads payments');
INSERT INTO financial_report_results(tap) SELECT lives_ok(
 'SELECT public.get_pb1_report_v6(1,2000)','Owner reads PB1');
INSERT INTO financial_report_results(tap) SELECT lives_ok(
 'SELECT public.calculate_pb1_payable_v5(''2000-01-01'',''2000-01-01'')','Owner reads PB1 calculation');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE authenticated;
INSERT INTO financial_report_results(tap) SELECT throws_ok(
 'SELECT public.get_pb1_report_v6(1,2000)','42501','financial_reports_owner_required','Unauthenticated caller denied');
RESET ROLE;
INSERT INTO financial_report_results(tap)
 SELECT ok(NOT has_function_privilege('anon',p.oid,'EXECUTE'),p.proname||' denies anon')
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('get_gross_margin_by_product_v5','get_payments_by_method_v5','get_pb1_report_v6','calculate_pb1_payable_v5');
INSERT INTO financial_report_results(tap) SELECT ok(NOT EXISTS(
 SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname ~ '^(get_gross_margin_by_product_v[1-4]|get_payments_by_method_v[1-4]|get_pb1_report_v[1-5]|calculate_pb1_payable_v[1-4])$'),
 'Legacy financial RPC bypasses are removed');
SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM financial_report_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
