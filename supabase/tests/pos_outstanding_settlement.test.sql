-- Vente différée, règlement multi-shift/BO, comptabilité et clôtures figées.
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
INSERT INTO outstanding_results SELECT ok(NOT has_function_privilege('anon',
  'public.settle_pos_outstanding_v2(uuid,payment_method,numeric,uuid,uuid,numeric)','EXECUTE'),'anonymous payment refused');
INSERT INTO outstanding_results SELECT throws_ok(format('SELECT public.defer_pos_order_v2(%L,NULL,%L,%L)',
  current_setting('out.order'),current_setting('out.origin'),gen_random_uuid()),'23514','outstanding_requires_customer','customer required');
CREATE TEMP TABLE deferred_snapshot AS SELECT public.defer_pos_order_v2(current_setting('out.order')::uuid,
  current_setting('out.customer')::uuid,current_setting('out.origin')::uuid,current_setting('out.defer_key')::uuid) AS result;
INSERT INTO outstanding_results SELECT is((result->>'outstanding_due')::numeric,100000::numeric,'whole total is outstanding') FROM deferred_snapshot;
INSERT INTO outstanding_results SELECT is((SELECT count(*)::int FROM public.order_payments WHERE order_id=current_setting('out.order')::uuid),0,'no fake payment created');
INSERT INTO outstanding_results SELECT is((SELECT current_stock FROM public.products WHERE id=current_setting('out.product')::uuid),99::numeric,'stock deducted when sale is deferred');
INSERT INTO outstanding_results SELECT is((public.defer_pos_order_v2(current_setting('out.order')::uuid,
  current_setting('out.customer')::uuid,current_setting('out.origin')::uuid,current_setting('out.defer_key')::uuid)->>'idempotent_replay')::boolean,
  true,'defer retry uses original result');
INSERT INTO outstanding_results SELECT is((SELECT current_stock FROM public.products WHERE id=current_setting('out.product')::uuid),99::numeric,'defer retry does not deduct stock twice');
INSERT INTO outstanding_results SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE reference_type='sale' AND reference_id=current_setting('out.order')::uuid),1,'one sale journal entry');
INSERT INTO outstanding_results SELECT ok(EXISTS(SELECT 1 FROM public.list_pos_outstanding_v1() WHERE order_id=current_setting('out.order')::uuid),'deferred sale appears in list');
INSERT INTO outstanding_results SELECT throws_ok(format('UPDATE public.order_items SET quantity=2 WHERE order_id=%L',current_setting('out.order')),
  '23514','outstanding_invoice_sealed','invoiced items cannot be changed');
INSERT INTO outstanding_results SELECT throws_ok(format('UPDATE public.orders SET status=''paid'' WHERE id=%L',current_setting('out.order')),
  '23514','outstanding_requires_settlement','legacy payment cannot bypass settlement');
SELECT public.close_shift_v13(current_setting('out.origin')::uuid,0,p_counted_qris:=0,p_counted_card:=0,p_denominations:='{}');
CREATE TEMP TABLE origin_snapshot AS SELECT public.get_shift_close_print_v1(current_setting('out.origin')::uuid) AS result;
INSERT INTO outstanding_results SELECT is((result->>'receipts_total')::numeric,0::numeric,'unpaid sale is not a shift receipt') FROM origin_snapshot;
DO $shift$
DECLARE v_shift uuid;
BEGIN
  INSERT INTO public.pos_sessions(opened_by,opening_cash,status)
    VALUES(current_setting('out.actor')::uuid,0,'open') RETURNING id INTO v_shift;
  PERFORM set_config('out.receiving',v_shift::text,true);
END $shift$;
INSERT INTO outstanding_results SELECT throws_ok(format('SELECT public.settle_pos_outstanding_v2(%L,''cash'',100001,%L,%L)',
  current_setting('out.order'),gen_random_uuid(),current_setting('out.receiving')),'23514','payment_exceeds_balance','overpayment refused');
SELECT public.settle_pos_outstanding_v2(current_setting('out.order')::uuid,'cash',30000,
  current_setting('out.cash_key')::uuid,current_setting('out.receiving')::uuid);
SELECT public.settle_pos_outstanding_v2(current_setting('out.order')::uuid,'edc',20000,gen_random_uuid(),current_setting('out.receiving')::uuid);
SELECT public.settle_pos_outstanding_v2(current_setting('out.order')::uuid,'qris',20000,gen_random_uuid(),current_setting('out.receiving')::uuid);
SELECT public.settle_pos_outstanding_v2(current_setting('out.order')::uuid,'cash',5000,current_setting('out.bo_cash_key')::uuid,NULL);
SELECT public.settle_pos_outstanding_v2(current_setting('out.order')::uuid,'transfer',5000,gen_random_uuid(),NULL);
INSERT INTO outstanding_results SELECT is((SELECT count(*)::int FROM public.order_payments
  WHERE order_id=current_setting('out.order')::uuid AND session_id IS NULL),2,'BO collections have no shift');
INSERT INTO outstanding_results SELECT ok(EXISTS(SELECT 1 FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
  WHERE j.reference_id=current_setting('out.bo_cash_key')::uuid AND l.account_id=public.resolve_mapping_account('CASH_WALLET_UNDEPOSITED') AND l.debit=5000),
  'BO cash goes to treasury rather than a POS drawer');
INSERT INTO outstanding_results SELECT is((SELECT due FROM public.list_pos_outstanding_v1() WHERE order_id=current_setting('out.order')::uuid),20000::numeric,'partial balance remains in list');
SELECT public.settle_pos_outstanding_v2(current_setting('out.order')::uuid,'transfer',20000,gen_random_uuid(),current_setting('out.receiving')::uuid);
INSERT INTO outstanding_results SELECT ok(NOT EXISTS(SELECT 1 FROM public.list_pos_outstanding_v1()
  WHERE order_id=current_setting('out.order')::uuid),'fully settled sale leaves unpaid list');
INSERT INTO outstanding_results SELECT is((SELECT count(*)::int FROM public.journal_entries WHERE reference_type='sale' AND reference_id=current_setting('out.order')::uuid),1,'settlement does not duplicate revenue');
INSERT INTO outstanding_results SELECT is((SELECT current_stock FROM public.products WHERE id=current_setting('out.product')::uuid),99::numeric,'settlement does not deduct stock again');
INSERT INTO outstanding_results SELECT is(public.get_shift_close_print_v1(current_setting('out.origin')::uuid),result,'original closing report remains unchanged') FROM origin_snapshot;
SELECT public.close_shift_v13(current_setting('out.receiving')::uuid,30000,p_counted_qris:=20000,p_counted_card:=20000,p_denominations:='{"10000":3}');
CREATE TEMP TABLE receiving_snapshot AS SELECT public.get_shift_close_print_v1(current_setting('out.receiving')::uuid) AS result;
INSERT INTO outstanding_results SELECT is((result->>'receipts_total')::numeric,90000::numeric,'receiving shift includes all POS collections') FROM receiving_snapshot;
INSERT INTO outstanding_results SELECT is((result->'totals_by_payment_method'->>'cash')::numeric,30000::numeric,'closing cash includes debt collection') FROM receiving_snapshot;
INSERT INTO outstanding_results SELECT is((result->'totals_by_payment_method'->>'edc')::numeric,20000::numeric,'closing EDC includes debt collection') FROM receiving_snapshot;
INSERT INTO outstanding_results SELECT is((result->'totals_by_payment_method'->>'qris')::numeric,20000::numeric,'closing QRIS includes debt collection') FROM receiving_snapshot;
INSERT INTO outstanding_results SELECT is((result->'totals_by_payment_method'->>'transfer')::numeric,20000::numeric,'closing transfer excludes BO receipt') FROM receiving_snapshot;
INSERT INTO outstanding_results SELECT is((public.settle_pos_outstanding_v2(current_setting('out.order')::uuid,'cash',30000,
  current_setting('out.cash_key')::uuid,current_setting('out.receiving')::uuid)->>'idempotent_replay')::boolean,true,'lost response retry works after shift close');
INSERT INTO outstanding_results SELECT is((SELECT count(*)::int FROM public.order_payments WHERE order_id=current_setting('out.order')::uuid),6,'retry does not duplicate collection');
INSERT INTO outstanding_results SELECT throws_ok(format('SELECT public.settle_pos_outstanding_v2(%L,''cash'',30001,%L,%L)',
  current_setting('out.order'),current_setting('out.cash_key'),current_setting('out.receiving')),'22023','idempotency_conflict','same key cannot record a different receipt');
INSERT INTO outstanding_results SELECT ok(NOT EXISTS(SELECT 1 FROM public.journal_entries j
  JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
  WHERE j.reference_id=current_setting('out.order')::uuid OR j.reference_id IN
    (SELECT p.key FROM public.pos_payment_attempt_keys p WHERE p.order_id=current_setting('out.order')::uuid)
  GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit)),'sale and collection entries balance');

DO $shift$ DECLARE v_shift uuid; BEGIN
 INSERT INTO public.pos_sessions(opened_by,opening_cash,status)
 VALUES(current_setting('out.actor')::uuid,100000,'open') RETURNING id INTO v_shift;
 PERFORM set_config('out.refund_shift',v_shift::text,true);
 PERFORM set_config('out.void_key',gen_random_uuid()::text,true);
END $shift$;
SELECT public.void_order_rpc_v14(current_setting('out.order')::uuid,'Outstanding reversal fixture',
 current_setting('out.actor')::uuid,
 (SELECT auth_user_id FROM user_profiles WHERE id=current_setting('out.actor')::uuid),current_setting('out.void_key')::uuid,
 'pos',current_setting('out.refund_shift')::uuid);
INSERT INTO outstanding_results SELECT is((SELECT payment_session_id FROM refunds WHERE order_id=current_setting('out.order')::uuid),
 current_setting('out.refund_shift')::uuid,'void cash belongs to refund shift');
INSERT INTO outstanding_results SELECT is((public.get_shift_close_preview_v1(current_setting('out.refund_shift')::uuid)->>'expectedCash')::numeric,
 65000::numeric,'preview deducts full cash refund once in refund shift');
INSERT INTO outstanding_results SELECT is(public.get_shift_close_print_v1(current_setting('out.receiving')::uuid),result,
 'closed receiving report unchanged after later void') FROM receiving_snapshot;
SELECT public.close_shift_v13(current_setting('out.refund_shift')::uuid,65000,p_denominations:='{"50000":1,"10000":1,"5000":1}');
INSERT INTO outstanding_results SELECT is((public.get_shift_close_print_v1(current_setting('out.refund_shift')::uuid)->'totals_by_payment_method'->>'cash')::numeric,
 -35000::numeric,'closing reports actual cash refund once');
INSERT INTO outstanding_results SELECT is((SELECT current_stock FROM products WHERE id=current_setting('out.product')::uuid),100::numeric,'void restores stock once');
INSERT INTO outstanding_results SELECT is((SELECT count(*)::int FROM journal_entries WHERE reference_type='sale_void' AND reference_id=current_setting('out.order')::uuid),
 1,'one void journal');


DO $small$ DECLARE v_shift uuid; v_order uuid; BEGIN
 INSERT INTO public.pos_sessions(opened_by,opening_cash,status) VALUES(current_setting('out.actor')::uuid,0,'open') RETURNING id INTO v_shift;
 UPDATE products SET retail_price=100 WHERE id=current_setting('out.product')::uuid;
 INSERT INTO orders(order_number,order_type,status,created_via,session_id,served_by,sent_to_kitchen_at,subtotal,tax_amount,total)
 VALUES('SMALL-'||gen_random_uuid(),'take_out','pending_payment','pos',v_shift,current_setting('out.actor')::uuid,now(),200,0,200) RETURNING id INTO v_order;
 INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,is_locked,sent_to_kitchen_at,modifiers)
 VALUES(v_order,current_setting('out.product')::uuid,'Small fixture',100,2,200,'pending',true,now(),'[]');
 PERFORM set_config('out.small',v_order::text,true);
 PERFORM set_config('out.small_shift',v_shift::text,true);
END $small$;
SELECT public.defer_pos_order_v2(current_setting('out.small')::uuid,current_setting('out.customer')::uuid,current_setting('out.small_shift')::uuid,gen_random_uuid());
INSERT INTO outstanding_results SELECT is((SELECT tax_amount FROM orders WHERE id=current_setting('out.small')::uuid),0::numeric,'zero tax sale posts successfully');
SELECT public.settle_pos_outstanding_v2(current_setting('out.small')::uuid,'cash',10,gen_random_uuid(),current_setting('out.small_shift')::uuid,0);
INSERT INTO outstanding_results SELECT throws_ok(format('SELECT public.settle_pos_outstanding_v2(%L,''cash'',10,%L,%L,0)',
 current_setting('out.small'),gen_random_uuid(),current_setting('out.small_shift')),'23514','outstanding_balance_changed_refresh','stale second tab cannot collect again');
SELECT public.settle_pos_outstanding_v2(current_setting('out.small')::uuid,'cash',190,gen_random_uuid(),current_setting('out.small_shift')::uuid,10);
SELECT public.refund_order_rpc_v15(
 p_order_id:=current_setting('out.small')::uuid,
 p_lines:=(SELECT jsonb_build_array(jsonb_build_object('order_item_id',id,'qty',1)) FROM order_items WHERE order_id=current_setting('out.small')::uuid),
 p_tenders:='[{"method":"cash","amount":100}]',p_reason:='Partial outstanding refund fixture',
 p_authorized_by:=current_setting('out.actor')::uuid,p_idempotency_key:=gen_random_uuid(),
 p_acting_auth_user_id:=(SELECT auth_user_id FROM user_profiles WHERE id=current_setting('out.actor')::uuid),
 p_refund_source:='pos',p_session_id:=current_setting('out.small_shift')::uuid);
INSERT INTO outstanding_results SELECT is((public.get_shift_close_preview_v1(current_setting('out.small_shift')::uuid)->>'expectedCash')::numeric,
 100::numeric,'partial refund reduces current drawer once');
INSERT INTO outstanding_results SELECT is((SELECT current_stock FROM products WHERE id=current_setting('out.product')::uuid),99::numeric,'partial refund restores exact quantity');

SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO outstanding_results SELECT * FROM finish();
SELECT jsonb_agg(result) FROM outstanding_results;
ROLLBACK;
