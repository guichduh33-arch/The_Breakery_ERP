BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE blind_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('CASHIER'),('MANAGER'),('ADMIN')) r(role_code);
INSERT INTO auth.users(id,email) SELECT auth_user_id,auth_user_id||'@blind.invalid' FROM blind_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'BLIND-'||id,'Blind cash fixture','invalid-fixture',role_code,true FROM blind_actors;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,true,'Blind cash transactional fixture' FROM blind_actors a CROSS JOIN public.permissions p
 WHERE a.role_code<>'SUPER_ADMIN'
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
CREATE TEMP TABLE blind_ids AS SELECT gen_random_uuid() session_id,gen_random_uuid() other_session,
 gen_random_uuid() cash_order,gen_random_uuid() card_order,gen_random_uuid() draft_order,gen_random_uuid() refund_id;
CREATE TEMP TABLE blind_payload(name text PRIMARY KEY,value jsonb);
CREATE TEMP TABLE blind_results(seq serial,tap text);
GRANT SELECT ON blind_ids,blind_actors TO authenticated;
GRANT ALL ON blind_payload,blind_results TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE blind_results_seq_seq TO authenticated;
INSERT INTO public.pos_sessions(id,opened_by,opened_at,opening_cash,status)
 SELECT session_id,(SELECT id FROM blind_actors WHERE role_code='CASHIER'),now(),1000,'open'::public.shift_status::public.shift_status FROM blind_ids
 UNION ALL SELECT other_session,(SELECT id FROM blind_actors WHERE role_code='MANAGER'),now(),0,'open'::public.shift_status FROM blind_ids;
INSERT INTO public.orders(id,order_number,session_id,status,subtotal,tax_amount,total,paid_at)
 SELECT cash_order,'BLIND-'||cash_order,session_id,'completed'::public.order_status,10000,0,10000,now() FROM blind_ids
 UNION ALL SELECT card_order,'BLIND-'||card_order,session_id,'paid',20000,0,20000,now() FROM blind_ids
 UNION ALL SELECT draft_order,'BLIND-'||draft_order,session_id,'draft',30000,0,30000,NULL FROM blind_ids;
INSERT INTO public.order_payments(order_id,session_id,method,amount)
 SELECT cash_order,session_id,'cash'::public.payment_method,10000 FROM blind_ids
 UNION ALL SELECT card_order,session_id,'card',20000 FROM blind_ids
 UNION ALL SELECT cash_order,other_session,'transfer',123 FROM blind_ids;
INSERT INTO public.refunds(id,refund_number,order_id,session_id,total,reason,refunded_by,authorized_by)
 SELECT refund_id,'BLIND-'||refund_id,cash_order,session_id,100,'Fixture refund',
 (SELECT id FROM blind_actors WHERE role_code='CASHIER'),(SELECT id FROM blind_actors WHERE role_code='SUPER_ADMIN') FROM blind_ids;
INSERT INTO public.refund_payments(refund_id,method,amount) SELECT refund_id,'cash',100 FROM blind_ids;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM blind_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO blind_results(tap) SELECT is((SELECT count(*) FROM public.order_payments WHERE session_id=(SELECT session_id FROM blind_ids)),0::bigint,'Cashier cannot bulk-read own open-shift payments');
INSERT INTO blind_results(tap) SELECT is((SELECT count(*) FROM public.refunds WHERE id=(SELECT refund_id FROM blind_ids)),0::bigint,'Refund ledger cannot reveal open-shift totals');
INSERT INTO blind_results(tap) SELECT is((SELECT count(*) FROM public.refund_payments WHERE refund_id=(SELECT refund_id FROM blind_ids)),0::bigint,'Refund tenders cannot bypass their parent policy');
INSERT INTO blind_payload SELECT 'blind',public.get_pos_transaction_history_v1(session_id) FROM blind_ids;
INSERT INTO blind_results(tap) SELECT is(value->'financial_visible','false'::jsonb,'Cashier has no live cumulative financial visibility') FROM blind_payload WHERE name='blind';
INSERT INTO blind_results(tap) SELECT is(value->'orders','[]'::jsonb,'Blind lookup returns no list, prices or payment methods') FROM blind_payload WHERE name='blind';
INSERT INTO blind_results(tap) SELECT is(value->'detail','null'::jsonb,'Blind lookup returns no unsolicited receipt detail') FROM blind_payload WHERE name='blind';
INSERT INTO blind_payload SELECT 'exact',public.get_pos_transaction_history_v1(session_id,'BLIND-'||cash_order) FROM blind_ids;
INSERT INTO blind_results(tap) SELECT is(jsonb_array_length(value->'orders'),1,'Exact receipt returns one transaction') FROM blind_payload WHERE name='exact';
INSERT INTO blind_results(tap) SELECT is(jsonb_array_length(value->'detail'->'order_payments'),1,'Exact receipt cannot include a payment received in another open shift') FROM blind_payload WHERE name='exact';
INSERT INTO blind_results(tap) SELECT is(value->'detail'->'order_payments'->0->>'method','cash','Exact receipt preserves tender for authorized refund') FROM blind_payload WHERE name='exact';
INSERT INTO blind_results(tap) SELECT is(jsonb_array_length(value->'detail'->'refunds'),1,'Exact receipt preserves prior refunds') FROM blind_payload WHERE name='exact';
INSERT INTO blind_results(tap) SELECT is(public.get_pos_transaction_history_v1(session_id,'BLIND-%')->'orders','[]'::jsonb,'Lookup rejects wildcard enumeration by exact equality') FROM blind_ids;
INSERT INTO blind_results(tap) SELECT is(public.get_pos_transaction_history_v1(session_id,'BLIND-'||draft_order)->'orders','[]'::jsonb,'Drafts never enter financial transaction history') FROM blind_ids;
INSERT INTO blind_results(tap) SELECT throws_ok(format('SELECT public.get_pos_transaction_history_v1(%L)',other_session),'P0003','permission_denied','Cashier cannot enumerate another open shift') FROM blind_ids;
INSERT INTO blind_results(tap) SELECT throws_ok(format('SELECT public.get_pos_transaction_history_v1(%L,%L)',session_id,'x'),'22023','invalid_receipt_number','Receipt input is bounded server-side') FROM blind_ids;
RESET ROLE;
INSERT INTO blind_results(tap) SELECT ok(EXISTS(SELECT 1 FROM public.audit_logs WHERE actor_id=(SELECT id FROM blind_actors WHERE role_code='CASHIER') AND action='pos.receipt.lookup' AND entity_id=(SELECT cash_order FROM blind_ids)),'Exact receipt lookup records the profile actor');
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM blind_actors WHERE role_code='SUPER_ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO blind_payload SELECT 'owner',public.get_pos_transaction_history_v1(session_id) FROM blind_ids;
INSERT INTO blind_results(tap) SELECT is(value->'financial_visible','true'::jsonb,'Owner retains live financial visibility') FROM blind_payload WHERE name='owner';
INSERT INTO blind_results(tap) SELECT is(jsonb_array_length(value->'orders'),2,'Owner sees both finalized orders, excluding draft') FROM blind_payload WHERE name='owner';
RESET ROLE;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM blind_actors WHERE role_code='ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO blind_results(tap) SELECT throws_ok(format('SELECT public.get_pos_transaction_history_v1(%L,%L)',session_id,'BLIND-'||cash_order),'P0003','permission_denied','ADMIN cannot use receipt lookup to bypass open-day confidentiality') FROM blind_ids;
RESET ROLE;
UPDATE public.pos_sessions SET status='closed',closed_at=now() WHERE id=(SELECT session_id FROM blind_ids);
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM blind_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO blind_payload SELECT 'closed',public.get_pos_transaction_history_v1(session_id) FROM blind_ids;
INSERT INTO blind_results(tap) SELECT is(value->'financial_visible','true'::jsonb,'Shift closure releases cumulative visibility') FROM blind_payload WHERE name='closed';
INSERT INTO blind_results(tap) SELECT is(jsonb_array_length(value->'orders'),2,'Closed shift history has paid and completed orders') FROM blind_payload WHERE name='closed';
INSERT INTO blind_results(tap) SELECT is((SELECT count(*) FROM public.order_payments WHERE session_id=(SELECT session_id FROM blind_ids)),2::bigint,'Closed-shift payment ledger is readable again');
INSERT INTO blind_results(tap) SELECT is((SELECT count(*) FROM public.order_payments WHERE session_id=(SELECT other_session FROM blind_ids)),0::bigint,'Another receiving shift remains private');
RESET ROLE;
INSERT INTO blind_results(tap) SELECT ok(NOT has_function_privilege('anon','public.get_pos_transaction_history_v1(uuid,text)','EXECUTE'),'Anonymous role cannot call history RPC');
INSERT INTO blind_results(tap) SELECT ok(has_function_privilege('authenticated','public.get_pos_transaction_history_v1(uuid,text)','EXECUTE'),'PIN-authenticated caller can use the guarded RPC');
INSERT INTO blind_results(tap) SELECT * FROM finish();
SELECT tap FROM blind_results ORDER BY seq;
ROLLBACK;
