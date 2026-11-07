-- Les identités, clients, ajustements et audits de cette recette sont annulés.
BEGIN;
CREATE TEMP TABLE loyalty_fix_results(seq serial, tap text);
CREATE TEMP TABLE loyalty_fix_fixture AS
 SELECT gen_random_uuid() AS actor_id, gen_random_uuid() AS auth_id,
        gen_random_uuid() AS customer_id, gen_random_uuid() AS adjustment_key;
GRANT INSERT ON loyalty_fix_results TO authenticated;
GRANT SELECT ON loyalty_fix_fixture TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE loyalty_fix_results_seq_seq TO authenticated;

DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM loyalty_fix_fixture;
 INSERT INTO auth.users(id,email) VALUES(f.auth_id,f.auth_id||'@loyalty-adjustment.invalid');
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 VALUES(f.actor_id,f.auth_id,'LAF-'||f.actor_id,'Loyalty adjustment fixture','invalid-test-hash','ADMIN',true);
 INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 VALUES(f.actor_id,'loyalty.adjust',true,'Transactional adjustment regression');
 INSERT INTO public.customers(id,name,loyalty_points,lifetime_points)
 VALUES(f.customer_id,'Loyalty adjustment fixture',100,100);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',f.auth_id,'role','authenticated')::text,true);
 PERFORM no_plan();
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE f record; original jsonb; replay jsonb; debit jsonb;
BEGIN
 SELECT * INTO f FROM loyalty_fix_fixture;
 original:=public.adjust_loyalty_points_v3(f.customer_id,25,'  Correct missed points  ',f.adjustment_key);
 INSERT INTO loyalty_fix_results(tap) VALUES
  (ok(jsonb_typeof(original)='object','Adjustment returns a JSON object')),
  (ok(original->>'txn_id' IS NOT NULL,'Adjustment identifies its ledger transaction')),
  (ok((original->>'new_balance')::int=125 AND (original->>'new_lifetime')::int=125,
      'Credit updates balance and lifetime points')),
  (ok(original->>'actor_id'=f.actor_id::text AND original->>'customer_id'=f.customer_id::text
      AND original->>'idempotency_key'=f.adjustment_key::text AND original->>'reason'='Correct missed points',
      'Result binds actor, customer, operation key and trimmed reason'));
 replay:=public.adjust_loyalty_points_v3(f.customer_id,25,'Correct missed points',f.adjustment_key);
 INSERT INTO loyalty_fix_results(tap) VALUES
  (ok((replay->>'idempotent_replay')::boolean,'Retry identifies its replay')),
  (is(replay->>'txn_id',original->>'txn_id','Retry returns the original ledger transaction')),
  (throws_ok(format('SELECT public.adjust_loyalty_points_v3(%L::uuid,26,%L,%L::uuid)',
      f.customer_id,'Correct missed points',f.adjustment_key),
      'P0012','idempotency_conflict','A key cannot be reused with a different delta')),
  (throws_ok(format('SELECT public.adjust_loyalty_points_v3(%L::uuid,25,%L,NULL)',
      f.customer_id,'Correct missed points'),
      '23514','idempotency_key_required','A missing key is rejected')),
  (throws_ok(format('SELECT public.adjust_loyalty_points_v3(%L::uuid,-1000,%L,%L::uuid)',
      f.customer_id,'Correct missed points',gen_random_uuid()),
      'P0001','insufficient_balance','Debit cannot make the points balance negative'));
 debit:=public.adjust_loyalty_points_v3(f.customer_id,-5,'Correct excess points',gen_random_uuid());
 INSERT INTO loyalty_fix_results(tap) VALUES
  (ok((debit->>'new_balance')::int=120 AND (debit->>'new_lifetime')::int=125,
      'A separate debit reduces balance without reducing lifetime points'));
END $$;

SET LOCAL ROLE postgres;
DO $$
DECLARE f record;
BEGIN
 SELECT * INTO f FROM loyalty_fix_fixture;
 INSERT INTO loyalty_fix_results(tap) VALUES
  (ok((SELECT loyalty_points=120 AND lifetime_points=125 FROM public.customers WHERE id=f.customer_id),
      'Customer balance includes each distinct adjustment exactly once')),
  (is((SELECT count(*) FROM public.loyalty_transactions WHERE customer_id=f.customer_id),2::bigint,
      'Replay creates no duplicate ledger row')),
  (is((SELECT count(*) FROM public.audit_logs WHERE entity_id=f.customer_id
      AND action='loyalty.adjust' AND actor_id=f.actor_id),2::bigint,
      'Each distinct adjustment has one audit under the profile actor')),
  (is((SELECT count(*) FROM public.loyalty_operation_results WHERE customer_id=f.customer_id),2::bigint,
      'Distinct adjustment results are stored exactly once')),
  (ok(NOT has_function_privilege('anon','public.adjust_loyalty_points_v3(uuid,integer,text,uuid)','EXECUTE'),
      'Anonymous execution remains denied')),
  (ok(to_regprocedure('public.adjust_loyalty_points_v2(uuid,integer,text)') IS NULL,
      'The removed contract remains absent'));
 UPDATE public.user_permission_overrides SET is_granted=false
 WHERE user_profile_id=f.actor_id AND permission_code='loyalty.adjust';
 INSERT INTO loyalty_fix_results(tap) VALUES
  (throws_ok(format('SELECT public.adjust_loyalty_points_v3(%L::uuid,25,%L,%L::uuid)',
      f.customer_id,'Correct missed points',gen_random_uuid()),
      'P0001','forbidden','The dedicated adjustment permission is required'));
END $$;

SELECT jsonb_build_object('assertions',count(*),'failures',count(*) FILTER(WHERE tap LIKE 'not ok%'),
 'tap',jsonb_agg(tap ORDER BY seq)) AS results FROM loyalty_fix_results;
ROLLBACK;
