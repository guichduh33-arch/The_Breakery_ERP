-- Paiement initial partiel : crédit sur le reste, comptabilité, rejeu et clôture.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE outstanding_results(result text);
DO $fixture$
DECLARE v_actor uuid; v_auth uuid; v_customer uuid; v_product uuid; v_order uuid; v_shift uuid;
BEGIN
  SELECT id,auth_user_id INTO v_actor,v_auth FROM public.user_profiles
    WHERE deleted_at IS NULL AND is_active AND role_code='SUPER_ADMIN' AND auth_user_id IS NOT NULL LIMIT 1;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'fixture: SUPER_ADMIN required'; END IF;
  PERFORM set_config('request.jwt.claim.sub',v_auth::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_auth)::text,true);
  UPDATE public.pos_sessions SET status='closed',closed_at=now(),closed_by=v_actor,closing_cash=0
    WHERE opened_by=v_actor AND status='open';
  INSERT INTO public.pos_sessions(opened_by,opening_cash,status) VALUES(v_actor,0,'open') RETURNING id INTO v_shift;
  INSERT INTO public.customers(name,retail_credit_limit) VALUES('Outstanding fixture',1000000) RETURNING id INTO v_customer;
  INSERT INTO public.products(sku,name,category_id,retail_price,unit,cost_price,current_stock,track_inventory)
    VALUES('OUT-'||gen_random_uuid(),'Outstanding fixture',(SELECT id FROM public.categories LIMIT 1),100000,'pcs',0,100,true)
    RETURNING id INTO v_product;
  INSERT INTO public.orders(order_number,order_type,status,created_via,session_id,served_by,
    sent_to_kitchen_at,subtotal,tax_amount,total)
    VALUES('OUT-'||gen_random_uuid(),'take_out','pending_payment','pos',v_shift,v_actor,now(),100000,0,100000)
    RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,
    kitchen_status,is_locked,sent_to_kitchen_at,modifiers)
    VALUES(v_order,v_product,'Outstanding fixture',100000,1,100000,'pending',true,now(),'[]');
  PERFORM set_config('out.actor',v_actor::text,true);
  PERFORM set_config('out.customer',v_customer::text,true);
  PERFORM set_config('out.product',v_product::text,true);
  PERFORM set_config('out.order',v_order::text,true);
  PERFORM set_config('out.origin',v_shift::text,true);
  PERFORM set_config('out.defer_key',gen_random_uuid()::text,true);
  PERFORM set_config('out.cash_key',gen_random_uuid()::text,true);
  PERFORM set_config('out.bo_cash_key',gen_random_uuid()::text,true);
END $fixture$;
SELECT throws_ok(format('SELECT public.defer_pos_order_v4(%L,%L,%L,%L,p_payments:=%L::jsonb)',
 current_setting('out.order'),current_setting('out.customer'),current_setting('out.origin'),gen_random_uuid(),
 '[{"method":"cash","amount":100000,"cash_received":100000}]'),'23514',NULL,'full payment must use normal checkout');
UPDATE customers SET retail_credit_limit=10000 WHERE id=current_setting('out.customer')::uuid;
SELECT throws_ok(format('SELECT public.defer_pos_order_v4(%L,%L,%L,%L,p_payments:=%L::jsonb)',
 current_setting('out.order'),current_setting('out.customer'),current_setting('out.origin'),gen_random_uuid(),
 '[{"method":"cash","amount":30000,"cash_received":30000}]'),NULL,NULL,'remaining balance must fit customer credit limit');
SELECT is((SELECT count(*)::int FROM order_payments WHERE order_id=current_setting('out.order')::uuid),0,'credit rejection leaves no payment');
SELECT is((SELECT current_stock FROM products WHERE id=current_setting('out.product')::uuid),100::numeric,'credit rejection leaves stock unchanged');
UPDATE customers SET retail_credit_limit=70000 WHERE id=current_setting('out.customer')::uuid;
CREATE TEMP TABLE partial_snapshot AS SELECT public.defer_pos_order_v4(
 current_setting('out.order')::uuid,current_setting('out.customer')::uuid,current_setting('out.origin')::uuid,
 current_setting('out.defer_key')::uuid,p_payments:='[{"method":"cash","amount":30000,"cash_received":30000}]') result;
SELECT is((result->>'amount_received')::numeric,30000::numeric,'only actual cash is received') FROM partial_snapshot;
SELECT is((result->>'remaining_due')::numeric,70000::numeric,'only the balance is deferred') FROM partial_snapshot;
SELECT is((result->>'outstanding_due')::numeric,70000::numeric,'receipt balance matches outstanding') FROM partial_snapshot;
SELECT is((SELECT sum(amount) FROM order_payments WHERE order_id=current_setting('out.order')::uuid),30000::numeric,'one actual tender');
SELECT is((SELECT current_stock FROM products WHERE id=current_setting('out.product')::uuid),99::numeric,'stock deducted once');
SELECT ok((public.defer_pos_order_v4(current_setting('out.order')::uuid,current_setting('out.customer')::uuid,
 current_setting('out.origin')::uuid,current_setting('out.defer_key')::uuid,
 p_payments:='[{"method":"cash","amount":30000,"cash_received":30000}]')->>'idempotent_replay')::boolean,'same key returns first result');
SELECT is((SELECT count(*)::int FROM order_payments WHERE order_id=current_setting('out.order')::uuid),1,'retry never duplicates payment');
SELECT is((SELECT count(*)::int FROM journal_entries WHERE reference_type='sale' AND reference_id=current_setting('out.order')::uuid),1,'one sale journal');
SELECT is((SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
 WHERE j.reference_type='sale' AND j.reference_id=current_setting('out.order')::uuid),0::numeric,'cash and receivable balance the sale');
SELECT is((SELECT sum(l.debit) FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.journal_entry_id
 WHERE j.reference_type='sale' AND j.reference_id=current_setting('out.order')::uuid
 AND l.account_id=resolve_mapping_account('POS_RECEIVABLE')),70000::numeric,'receivable equals outstanding balance');
SELECT ok(EXISTS(SELECT 1 FROM list_pos_outstanding_v1() WHERE order_id=current_setting('out.order')::uuid),'partial ticket remains collectible');
SELECT throws_ok(format('SELECT public.defer_pos_order_v4(%L,%L,%L,%L,p_payments:=%L::jsonb)',
 current_setting('out.order'),current_setting('out.customer'),current_setting('out.origin'),current_setting('out.defer_key'),
 '[{"method":"cash","amount":20000,"cash_received":20000}]'),'22023','idempotency_conflict','same key cannot change tender');
SELECT ok(NOT has_function_privilege('anon','public.defer_pos_order_v4(uuid,uuid,uuid,uuid,integer,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb)','EXECUTE'),'anonymous deferral denied');

SELECT throws_ok(format('SELECT defer_pos_order_v4(%L,%L,%L,%L,p_payments:=%L::jsonb)',
 current_setting('out.order'),current_setting('out.customer'),current_setting('out.origin'),gen_random_uuid(),
 '[{"method":"cash","amount":"NaN","cash_received":"NaN"}]'),'23514','invalid_tender','nonfinite amount rejected');
SELECT throws_ok(format('SELECT defer_pos_order_v4(%L,%L,%L,%L,p_payments:=%L::jsonb)',
 current_setting('out.order'),current_setting('out.customer'),current_setting('out.origin'),gen_random_uuid(),
 '[{"method":"cash","amount":30000,"cash_received":"NaN","change_given":"NaN"}]'),'23514','invalid_tender','nonfinite cash rejected');
SELECT * FROM finish();
ROLLBACK;
