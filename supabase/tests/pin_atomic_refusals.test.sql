-- Les refus restent des transactions réussies pour conserver le compteur de sécurité.
BEGIN;
\ir helpers/pin_session.sql
SELECT plan(32);
CREATE TEMP TABLE pin_refusal_cases(name text, query text, passed boolean);
DO $$
DECLARE a uuid := gen_random_uuid(); p uuid := gen_random_uuid(); s uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
  VALUES(p,a,'PINA-'||left(p::text,8),'PIN atomic fixture','SUPER_ADMIN',public.hash_pin('285741'),true);
  PERFORM pg_temp.authenticate_pin(a);
  INSERT INTO public.pos_sessions(id,opened_by,opening_cash,status) VALUES(s,p,0,'open');
  PERFORM set_config('pinatom.profile',p::text,true);
  PERFORM set_config('pinatom.shift',s::text,true);
  INSERT INTO public.business_config DEFAULT VALUES ON CONFLICT DO NOTHING;
  UPDATE public.business_config SET pin_max_failed=3,pin_lockout_minutes=7 WHERE id=1;
END $$;

SELECT ok(NOT has_function_privilege('anon','public.verify_login_pin_v1(uuid,text,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.verify_login_pin_v1(uuid,text,text)','EXECUTE')
  AND has_function_privilege('service_role','public.verify_login_pin_v1(uuid,text,text)','EXECUTE'),
  'login verifier remains service-only including inherited PUBLIC rights');
SET LOCAL ROLE authenticated;
SELECT throws_ok($q$ SELECT public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'285741','127.0.0.1') $q$,
  '42501',NULL,'authenticated cannot invoke the login verifier directly');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($q$ SELECT public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'285741','127.0.0.1') $q$,
  '42501',NULL,'anon cannot invoke the login verifier directly');
RESET ROLE;

SELECT is(public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'bad','127.0.0.1')->>'error',
  'invalid_pin_format','malformed PIN is rejected before counting');
SELECT is((SELECT failed_login_attempts FROM public.user_profiles WHERE id=current_setting('pinatom.profile')::uuid),
  0,'malformed PIN consumes no attempt');
SELECT is((public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'999999','127.0.0.1')->>'attempts_remaining')::int,
  2,'login applies the configured threshold');
SELECT public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'999999','127.0.0.1');
SELECT is((public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'999999','127.0.0.1')->>'attempts_remaining')::int,
  0,'third refusal commits the configured lockout');
SELECT ok((SELECT failed_login_attempts=3 AND locked_until BETWEEN now()+interval '7 minutes'-interval '1 second'
  AND now()+interval '7 minutes'+interval '1 second' FROM public.user_profiles
  WHERE id=current_setting('pinatom.profile')::uuid),'configured seven minute lock is stored');
SELECT is(public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'285741','127.0.0.1')->>'error',
  'account_locked','correct PIN cannot bypass an active lock');
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE actor_id=current_setting('pinatom.profile')::uuid
  AND action='login.failed'),3,'each login refusal retains one profile audit');
UPDATE public.user_profiles SET failed_login_attempts=2,locked_until=NULL WHERE id=current_setting('pinatom.profile')::uuid;
SELECT is((public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'285741','127.0.0.1')->>'ok')::boolean,
  true,'correct PIN is accepted');
SELECT ok((SELECT failed_login_attempts=0 AND locked_until IS NULL FROM public.user_profiles
  WHERE id=current_setting('pinatom.profile')::uuid),'successful verification resets the counter under the same lock');
UPDATE public.user_profiles SET is_active=false WHERE id=current_setting('pinatom.profile')::uuid;
SELECT is(public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'285741','127.0.0.1')->>'error',
  'user_inactive','inactive profile is refused');
UPDATE public.user_profiles SET is_active=true WHERE id=current_setting('pinatom.profile')::uuid;
SELECT is(public.verify_login_pin_v1(gen_random_uuid(),'285741','127.0.0.1')->>'error',
  'user_not_found','missing profile is refused');

-- Le fallback 5/15 ne dépend pas de la présence de données boutique.
DELETE FROM public.business_config;
SELECT is((public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'999999','127.0.0.1')->>'attempts_remaining')::int,
  4,'missing configuration preserves the five attempt fallback');
DO $$ BEGIN
  FOR i IN 1..4 LOOP
    PERFORM public.verify_login_pin_v1(current_setting('pinatom.profile')::uuid,'999999','127.0.0.1');
  END LOOP;
END $$;
SELECT ok((SELECT failed_login_attempts=5 AND locked_until BETWEEN now()+interval '15 minutes'-interval '1 second'
  AND now()+interval '15 minutes'+interval '1 second' FROM public.user_profiles
  WHERE id=current_setting('pinatom.profile')::uuid),'missing configuration preserves the fifteen minute fallback');
INSERT INTO public.business_config DEFAULT VALUES;
UPDATE public.business_config SET pin_max_failed=3,pin_lockout_minutes=7,
  shift_variance_threshold_abs=1,shift_variance_pin_threshold_abs=1,shift_denomination_count_enabled=false WHERE id=1;

INSERT INTO pin_refusal_cases(name,query) VALUES
('sign',$q$ SELECT public.sign_zreport_v3(gen_random_uuid(),'999999') $q$),
('void',$q$ SELECT public.void_zreport_v3(gen_random_uuid(),'Fixture reason','999999') $q$),
('period',$q$ SELECT public.close_fiscal_period_v2(gen_random_uuid(),'999999',false) $q$),
('journal',$q$ SELECT public.create_manual_je_v2('Fixture',CURRENT_DATE,'[{},{}]','999999') $q$),
('year',$q$ SELECT public.close_fiscal_year_v3(2098,'999999') $q$),
('expense',$q$ SELECT public.approve_expense_v5(gen_random_uuid(),'999999') $q$),
('balance',$q$ SELECT public.adjust_b2b_balance_v3(gen_random_uuid(),1,'Fixture reason','999999',gen_random_uuid()) $q$),
('shift',$q$ SELECT public.close_shift_v10(current_setting('pinatom.shift')::uuid,300000,
  p_notes:='Fixture reason',p_approver_id:=current_setting('pinatom.profile')::uuid,p_manager_pin:='999999') $q$);
DO $$
DECLARE c record; result jsonb; before_audit bigint;
BEGIN
  FOR c IN SELECT name,query FROM pin_refusal_cases LOOP
    UPDATE public.user_profiles SET failed_login_attempts=0,locked_until=NULL WHERE id=current_setting('pinatom.profile')::uuid;
    SELECT count(*) INTO before_audit FROM public.audit_logs
      WHERE actor_id=current_setting('pinatom.profile')::uuid AND action='pin.failed';
    EXECUTE c.query INTO result;
    UPDATE pin_refusal_cases SET passed=(result='{"ok":false,"error":"invalid_pin"}'::jsonb
      AND (SELECT failed_login_attempts=1 FROM public.user_profiles WHERE id=current_setting('pinatom.profile')::uuid)
      AND (SELECT count(*)=before_audit+1 FROM public.audit_logs
        WHERE actor_id=current_setting('pinatom.profile')::uuid AND action='pin.failed')) WHERE name=c.name;
  END LOOP;
END $$;
SELECT ok(passed,'business refusal retains exactly one counter and audit: '||name) FROM pin_refusal_cases ORDER BY name;
SELECT is((SELECT status::text FROM public.pos_sessions WHERE id=current_setting('pinatom.shift')::uuid),
  'open','PIN refusal leaves the shift open');
SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE created_by=current_setting('pinatom.profile')::uuid),
  0,'PIN refusals create no journal entry');
SELECT is((SELECT count(*)::int FROM public.expense_approvals WHERE approver_user_id=current_setting('pinatom.profile')::uuid),
  0,'PIN refusals create no expense approval');
SELECT is((SELECT count(*)::int FROM public.z_reports WHERE shift_id=current_setting('pinatom.shift')::uuid),
  0,'PIN refusals create no closing report');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY[
  'sign_zreport_v2','void_zreport_v2','close_fiscal_period_v1','create_manual_je_v1','close_fiscal_year_v2',
  'approve_expense_v4','adjust_b2b_balance_v2','close_shift_v9'])),0,'all eight old signatures are removed');
SELECT ok((SELECT bool_and(NOT has_function_privilege('anon',oid,'EXECUTE')) FROM pg_proc
  WHERE pronamespace='public'::regnamespace AND proname=ANY(ARRAY['sign_zreport_v3','void_zreport_v3',
  'close_fiscal_period_v2','create_manual_je_v2','close_fiscal_year_v3','approve_expense_v5','adjust_b2b_balance_v3','close_shift_v10'])),
  'all business writers remain unavailable to anon including inherited grants');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND has_function_privilege('authenticated',oid,'EXECUTE') AND proname=ANY(ARRAY['sign_zreport_v3','void_zreport_v3',
  'close_fiscal_period_v2','create_manual_je_v2','close_fiscal_year_v3','approve_expense_v5','adjust_b2b_balance_v3','close_shift_v10'])),
  8,'all eight business callers retain execute rights');
SELECT is((SELECT count(*)::int FROM public.user_sessions WHERE user_id=current_setting('pinatom.profile')::uuid),
  1,'the verifier itself creates no additional session');
SELECT * FROM finish();
ROLLBACK;
