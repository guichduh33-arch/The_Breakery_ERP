-- Remboursements nets par tender, sans double déduction des voids (ADR-013 D2).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(14);
CREATE TEMP TABLE refund_close_result (result jsonb);
DO $fixture$
DECLARE
  a uuid := gen_random_uuid(); p uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  o uuid; r uuid; m public.payment_method; owner_role text;
BEGIN
  SELECT code INTO owner_role FROM roles ORDER BY code LIMIT 1;
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO user_profiles(id,auth_user_id,role_code,full_name,employee_code,is_active,pin_hash)
    VALUES(p,a,owner_role,'Refund close fixture','REFC-' || left(p::text,8),true,extensions.crypt(gen_random_uuid()::text,extensions.gen_salt('bf')));
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES(p,'shift.close',true,'Regression fixture');
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
  INSERT INTO pos_sessions(id,opened_by,opening_cash,status) VALUES(s,p,0,'open');
  FOREACH m IN ARRAY ARRAY['cash','qris','card']::public.payment_method[] LOOP
    o := gen_random_uuid(); r := gen_random_uuid();
    INSERT INTO orders(id,order_number,session_id,status,subtotal,tax_amount,total,is_historical_import)
      VALUES(o,'REFC-'||o::text,s,'completed',22000,0,22000,true);
    INSERT INTO order_payments(order_id,method,amount) VALUES(o,m,22000);
    INSERT INTO refunds(id,refund_number,order_id,session_id,total,tax_refunded,reason,refunded_by,authorized_by,is_full_void)
      VALUES(r,'REFC-'||r::text,o,s,11000,0,'Regression partial',p,p,false);
    INSERT INTO refund_payments(refund_id,method,amount) VALUES(r,m,11000);
    IF m='cash' THEN
      r := gen_random_uuid();
      INSERT INTO refunds(id,refund_number,order_id,session_id,total,tax_refunded,reason,refunded_by,authorized_by,is_full_void)
        VALUES(r,'REFC-'||r::text,o,s,1000,0,'Regression store credit',p,p,false);
      INSERT INTO refund_payments(refund_id,method,amount) VALUES(r,'store_credit',1000);
    END IF;
  END LOOP;
  o := gen_random_uuid(); r := gen_random_uuid();
  INSERT INTO orders(id,order_number,session_id,status,subtotal,tax_amount,total,is_historical_import,voided_at,voided_by,void_reason)
    VALUES(o,'REFC-'||o::text,s,'voided',5000,0,5000,true,now(),p,'Regression void');
  INSERT INTO order_payments(order_id,method,amount) VALUES(o,'cash',5000);
  INSERT INTO refunds(id,refund_number,order_id,session_id,total,tax_refunded,reason,refunded_by,authorized_by,is_full_void)
    VALUES(r,'REFC-'||r::text,o,s,5000,0,'Regression void mirror',p,p,true);
  INSERT INTO refund_payments(refund_id,method,amount) VALUES(r,'cash',5000);
  PERFORM set_config('refclose.session',s::text,true);
  INSERT INTO refund_close_result SELECT close_shift_v9(s,11000,p_counted_qris:=11000,p_counted_card:=11000);
END $fixture$;
SELECT is((SELECT (result->>'expected_cash')::numeric FROM refund_close_result),11000::numeric,'Cash net of partial refund; store credit and void excluded');
SELECT is((SELECT (result->>'expected_qris')::numeric FROM refund_close_result),11000::numeric,'QRIS net of partial refund');
SELECT is((SELECT (result->>'expected_card')::numeric FROM refund_close_result),11000::numeric,'Card net of partial refund');
SELECT is((SELECT (result->>'variance')::numeric FROM refund_close_result),0::numeric,'No false cash shortage');
SELECT is((SELECT (result->>'variance_qris')::numeric FROM refund_close_result),0::numeric,'No false QRIS variance');
SELECT is((SELECT (result->>'variance_card')::numeric FROM refund_close_result),0::numeric,'No false card variance');
SELECT is((SELECT count(*)::int FROM journal_entries WHERE reference_type='shift_close' AND reference_id=current_setting('refclose.session')::uuid),0,'No false variance JE');
SELECT is((SELECT (snapshot#>>'{totals_by_payment_method,cash}')::numeric FROM z_reports WHERE shift_id=current_setting('refclose.session')::uuid),11000::numeric,'Snapshot cash agrees');
SELECT is((SELECT (snapshot#>>'{reconciliation,qris,expected}')::numeric FROM z_reports WHERE shift_id=current_setting('refclose.session')::uuid),11000::numeric,'Snapshot QRIS agrees');
SELECT is((SELECT (snapshot#>>'{reconciliation,card,expected}')::numeric FROM z_reports WHERE shift_id=current_setting('refclose.session')::uuid),11000::numeric,'Snapshot card agrees');
SELECT is((SELECT (snapshot->>'refunds_total')::numeric FROM z_reports WHERE shift_id=current_setting('refclose.session')::uuid),34000::numeric,'Refund total excludes full-void mirror');
SELECT ok((close_shift_v9(current_setting('refclose.session')::uuid,11000)->>'idempotent_replay')::boolean,'Retry does not close twice');
SELECT ok(NOT has_function_privilege('anon','public.close_shift_v9(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb)','EXECUTE'),'Anon denied');
SELECT ok(to_regprocedure('public.close_shift_v8(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb)') IS NULL,'Published previous version removed');
SELECT * FROM finish();
ROLLBACK;
