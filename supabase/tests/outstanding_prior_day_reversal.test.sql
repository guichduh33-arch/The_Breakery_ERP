-- Les factures anciennes restent des ventes ; leur retour est un remboursement du jour.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE prior_day_checks(result text);
CREATE TEMP TABLE prior_day_baselines(kind text PRIMARY KEY,value jsonb);
DO $fixture$
DECLARE a uuid; u uuid; origin uuid; receiving uuid; current_shift uuid; c uuid; p uuid; o uuid; d date:=current_date-35;
BEGIN
 SELECT id,auth_user_id INTO STRICT a,u FROM user_profiles
 WHERE role_code='SUPER_ADMIN' AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 INSERT INTO prior_day_baselines VALUES('sale',public.get_daily_sales_v4(d::text,d::text));
 INSERT INTO prior_day_baselines VALUES('today',public.get_daily_sales_v4(current_date::text,current_date::text));
 INSERT INTO pos_sessions(opened_by,opening_cash,status,opened_at,closed_at,closed_by,closing_cash,expected_cash)
 VALUES(a,0,'closed',d,d+interval '18 hours',a,0,0) RETURNING id INTO origin;
 INSERT INTO pos_sessions(opened_by,opening_cash,status,opened_at,closed_at,closed_by,closing_cash,expected_cash)
 VALUES(a,0,'closed',current_date-1,current_date-1+interval '18 hours',a,0,0) RETURNING id INTO receiving;
 SELECT id INTO current_shift FROM pos_sessions WHERE opened_by=a AND status='open' LIMIT 1;
 IF current_shift IS NULL THEN
   INSERT INTO pos_sessions(opened_by,opening_cash,status) VALUES(a,0,'open') RETURNING id INTO current_shift;
 END IF;
 INSERT INTO customers(name,total_spent,retail_credit_limit) VALUES('Prior-day reversal fixture',100000,1000000) RETURNING id INTO c;
 INSERT INTO products(sku,name,category_id,retail_price,unit,cost_price,current_stock,track_inventory,is_test)
 VALUES('PRIOR-'||gen_random_uuid(),'Prior-day fixture',(SELECT id FROM categories LIMIT 1),100000,'pcs',0,99,true,false) RETURNING id INTO p;
 INSERT INTO orders(order_number,order_type,status,created_via,session_id,served_by,customer_id,
   subtotal,tax_amount,total,created_at)
 VALUES('PRIOR-'||gen_random_uuid(),'take_out','pending_payment','pos',origin,a,c,90900,9100,100000,d) RETURNING id INTO o;
 INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,modifiers)
 VALUES(o,p,'Prior-day fixture',100000,1,100000,'pending','[]');
 -- Image d'une facture déjà finalisée puis soldée, sans transaction métier persistante.
 UPDATE orders SET outstanding_at=d+interval '12 hours',status='paid',paid_at=current_date-1+interval '12 hours' WHERE id=o;
 INSERT INTO order_payments(order_id,method,amount,paid_at,session_id)
 VALUES(o,'qris',100000,current_date-1+interval '12 hours',receiving);
 PERFORM set_config('prior.order',o::text,true); PERFORM set_config('prior.product',p::text,true);
 PERFORM set_config('prior.actor',a::text,true); PERFORM set_config('prior.auth',u::text,true);
 PERFORM set_config('prior.shift',current_shift::text,true);
END $fixture$;
INSERT INTO prior_day_checks SELECT throws_ok(format(
 'SELECT public.void_order_rpc_v14(%L,''Prior day void fixture'',%L,%L,%L,''pos'',%L)',
 current_setting('prior.order'),current_setting('prior.actor'),current_setting('prior.auth'),gen_random_uuid(),current_setting('prior.shift')),
 '23514','outstanding_prior_day_requires_refund','prior-day void cannot erase a recognized invoice');
INSERT INTO prior_day_checks SELECT is((SELECT status::text FROM orders WHERE id=current_setting('prior.order')::uuid),'paid','refused void leaves the original invoice intact');
INSERT INTO prior_day_checks SELECT is((SELECT count(*)::int FROM refunds WHERE order_id=current_setting('prior.order')::uuid),0,'refused void creates no refund');
INSERT INTO prior_day_checks SELECT is((SELECT current_stock FROM products WHERE id=current_setting('prior.product')::uuid),99::numeric,'refused void does not restore stock');
CREATE TEMP TABLE prior_day_refund AS SELECT public.refund_order_rpc_v15(
 p_order_id:=current_setting('prior.order')::uuid,
 p_lines:=(SELECT jsonb_agg(jsonb_build_object('order_item_id',id,'qty',quantity)) FROM order_items WHERE order_id=current_setting('prior.order')::uuid),
 p_tenders:='[{"method":"qris","amount":100000}]',p_reason:='Prior day full return fixture',
 p_authorized_by:=current_setting('prior.actor')::uuid,p_idempotency_key:=gen_random_uuid(),p_acting_auth_user_id:=current_setting('prior.auth')::uuid,
 p_refund_source:='pos',p_session_id:=current_setting('prior.shift')::uuid) result;
INSERT INTO prior_day_checks SELECT is((SELECT status::text FROM orders WHERE id=current_setting('prior.order')::uuid),'paid','full return keeps the historical sale record');
INSERT INTO prior_day_checks SELECT is((SELECT current_stock FROM products WHERE id=current_setting('prior.product')::uuid),100::numeric,'full refund restores the original quantity');
INSERT INTO prior_day_checks SELECT is((SELECT payment_session_id FROM refunds WHERE order_id=current_setting('prior.order')::uuid),current_setting('prior.shift')::uuid,'refund belongs to the current shift');
SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO prior_day_checks SELECT ok((SELECT bool_and(entry_date=current_date) FROM journal_entries
 WHERE reference_id=(result->>'refund_id')::uuid),'refund journal uses the current business day') FROM prior_day_refund;
INSERT INTO prior_day_checks SELECT is((public.get_daily_sales_v4((current_date-35)::text,(current_date-35)::text)->'summary'->>'total')::numeric
 -(value->'summary'->>'total')::numeric,100000::numeric,'historical sale remains in its original reporting day') FROM prior_day_baselines WHERE kind='sale';
INSERT INTO prior_day_checks SELECT is((public.get_daily_sales_v4(current_date::text,current_date::text)->'summary'->>'refund_total')::numeric
 -(value->'summary'->>'refund_total')::numeric,100000::numeric,'full return is reported on the actual refund day') FROM prior_day_baselines WHERE kind='today';
INSERT INTO prior_day_checks SELECT * FROM finish();
SELECT jsonb_agg(result) FROM prior_day_checks;
ROLLBACK;
