-- Les rôles et sessions de ce test disparaissent avec le ROLLBACK.
BEGIN;
\ir helpers/pin_session.sql
SELECT no_plan();
CREATE TEMP TABLE antifraud_results(seq serial,tap text);
CREATE TEMP TABLE antifraud_actors AS SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('ADMIN'),('CASHIER')) r(role_code);
INSERT INTO auth.users(id,email) SELECT auth_user_id,auth_user_id||'@visibility.invalid' FROM antifraud_actors;
INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'VIS-'||id,'Visibility fixture','invalid-test-hash',role_code,true FROM antifraud_actors;
INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
 SELECT a.id,p.code,true,'Transactional antifraud coverage' FROM antifraud_actors a CROSS JOIN public.permissions p
 WHERE a.role_code<>'SUPER_ADMIN'
 ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
CREATE TEMP TABLE antifraud_ids AS SELECT gen_random_uuid() product_id,gen_random_uuid() session_id,
 gen_random_uuid() order_id,gen_random_uuid() sale_je,gen_random_uuid() receipt_je,
 gen_random_uuid() receipt_key,gen_random_uuid() float_je,gen_random_uuid() customer_id,
 gen_random_uuid() b2b_key,gen_random_uuid() payment_key,gen_random_uuid() receiving_session_id;
CREATE TEMP TABLE antifraud_payload(name text PRIMARY KEY,value jsonb);
GRANT ALL ON antifraud_results,antifraud_payload TO authenticated;
GRANT SELECT ON antifraud_actors,antifraud_ids TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE antifraud_results_seq_seq TO authenticated;
-- Isoler les journées testées des shifts DEV préexistants, uniquement dans cette transaction.
UPDATE public.pos_sessions SET status='closed',closed_at=coalesce(closed_at,now()) WHERE status<>'closed';
INSERT INTO public.products(id,sku,name,category_id,retail_price,cost_price,current_stock,unit,is_display_item)
 SELECT product_id,'VIS-'||product_id,'Visibility product',(SELECT id FROM public.categories LIMIT 1),10000,1000,20,'pcs',true
 FROM antifraud_ids;
UPDATE public.display_stock SET quantity=20 WHERE product_id=(SELECT product_id FROM antifraud_ids);
INSERT INTO public.pos_sessions(id,opened_by,opened_at,opening_cash,status)
 SELECT session_id,(SELECT id FROM antifraud_actors WHERE role_code='CASHIER'),now(),1000,'open' FROM antifraud_ids;
INSERT INTO public.pos_sessions(id,opened_by,opened_at,opening_cash,status)
 SELECT receiving_session_id,(SELECT id FROM antifraud_actors WHERE role_code='ADMIN'),now(),0,'open' FROM antifraud_ids;
INSERT INTO public.shift_cash_treasury(session_id,opening_float)
 SELECT session_id,1000 FROM antifraud_ids ON CONFLICT(session_id) DO NOTHING;
UPDATE antifraud_ids SET float_je=(SELECT issued_je_id FROM public.shift_cash_treasury WHERE session_id=antifraud_ids.session_id);
INSERT INTO public.orders(id,order_number,session_id,status,subtotal,tax_amount,total,paid_at)
 SELECT order_id,'VIS-'||order_id,session_id,'completed',10000,0,10000,now() FROM antifraud_ids;
INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,dispatch_station)
 SELECT order_id,product_id,'Visibility product',10000,1,10000,'ready','kitchen' FROM antifraud_ids;
INSERT INTO public.journal_entries(id,entry_number,entry_date,description,reference_type,reference_id,status,total_debit,total_credit)
 SELECT sale_je,public.next_journal_entry_number(current_date),current_date,'Open sale fixture','sale',order_id,'posted',10000,10000 FROM antifraud_ids;
INSERT INTO public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description)
 SELECT sale_je,public.resolve_mapping_account('SALE_PAYMENT_CASH'),10000,0,'Fixture cash' FROM antifraud_ids UNION ALL
 SELECT sale_je,public.resolve_mapping_account('SALE_POS_REVENUE'),0,10000,'Fixture revenue' FROM antifraud_ids;
INSERT INTO public.pos_payment_attempt_keys(key,order_id,actor_id,request,result)
 SELECT receipt_key,order_id,(SELECT id FROM antifraud_actors WHERE role_code='CASHIER'),
 jsonb_build_object('operation','settle','session',receiving_session_id),jsonb_build_object('session_id',receiving_session_id) FROM antifraud_ids;
INSERT INTO public.journal_entries(id,entry_number,entry_date,description,reference_type,reference_id,status,total_debit,total_credit)
 SELECT receipt_je,public.next_journal_entry_number(current_date),current_date,'Receipt fixture','pos_outstanding_payment',receipt_key,'posted',100,100 FROM antifraud_ids;

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM antifraud_actors WHERE role_code='ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO antifraud_results(tap) SELECT ok(public.request_has_active_pin_session_v1(),'ADMIN fixture has a real active PIN session');
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_stock_v1(),'ADMIN never sees theoretical stock');
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_business_day_v2(current_date-365),'Historical dates never unlock stock');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT current_stock FROM public.products LIMIT 1','42501',NULL,'Raw product stock column remains denied');
INSERT INTO antifraud_results(tap) SELECT is((SELECT e->>'current_stock' FROM jsonb_array_elements(public.get_operational_products_v3()) e
 WHERE e->>'id'=(SELECT product_id::text FROM antifraud_ids)),NULL::text,'Operational catalogue masks exact stock');
INSERT INTO antifraud_results(tap) SELECT is((SELECT (e->'display_stock'->>'quantity')::numeric FROM jsonb_array_elements(public.get_operational_products_v3()) e
 WHERE e->>'id'=(SELECT product_id::text FROM antifraud_ids)),20::numeric,'ADMIN sees the display counter');
INSERT INTO antifraud_results(tap) SELECT is(public.get_operational_products_v2(),public.get_operational_products_v3(),'Deprecated v2 relays v3 unchanged');
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_sales_day_v1(current_date),'Open shift keeps the sales day private');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT public.get_sales_by_product_v6(current_date,current_date)','P0003','business_day_not_closed','Newest product-sales RPC refuses an open day');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT public.get_daily_sales_v5(current_date::text,current_date::text)','P0003','business_day_not_closed','Newest daily-sales RPC refuses an open day');
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_order_v2(order_id),'ADMIN cannot use the paid kitchen exception even with POS permissions') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_financial_entry_v1(sale_je),'Sale JE hidden while originating shift is open') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_financial_entry_v1(receipt_je),'Outstanding receipt JE hidden while receiving shift is open') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_financial_entry_v1(float_je),'Opening float JE hidden before shift close') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT is((SELECT count(*) FROM public.journal_entries WHERE id=(SELECT sale_je FROM antifraud_ids)),0::bigint,'Direct journal read cannot bypass the shift boundary');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT public.get_balance_sheet_v4(current_date)','P0003','stock_visibility_owner_required','Balance-sheet valuation is Owner only');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT public.get_profit_loss_v4(current_date,current_date)','P0003','stock_visibility_owner_required','Profit and loss is Owner only');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT public.get_movement_aggregates_v5(p_date_start=>current_date-1,p_date_end=>current_date)','P0003','stock_visibility_owner_required','Closed dates never unlock stock movement aggregates');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT * FROM public.get_cash_wallet_ledger_v4(''1141'',current_date,current_date)','P0003','stock_visibility_owner_required','Cash ledger cannot expose inventory accounts');
INSERT INTO antifraud_results(tap) SELECT lives_ok('SELECT * FROM public.get_customer_segments_v2()','Segmentation preserves its CTE column aliases');
INSERT INTO antifraud_results(tap) SELECT is((SELECT count(*) FROM public.shift_cash_treasury WHERE session_id=(SELECT session_id FROM antifraud_ids)),0::bigint,'Direct treasury read hides an open shift');
INSERT INTO antifraud_results(tap) SELECT ok((public.get_dashboard_overview_v7()->'kpis'->'cash_on_hand'->>'drawer') IS NULL
 AND (public.get_dashboard_overview_v7()->'kpis'->'cash_on_hand'->>'safe') IS NULL,'Dashboard hides live drawer and derived safe from ADMIN');
INSERT INTO antifraud_results(tap) SELECT ok((public.get_dashboard_overview_v7()->'cost_mtd'->>'restricted')::boolean
 AND public.get_dashboard_overview_v7()->'cost_mtd'->'lines'='[]'::jsonb,'Dashboard costs cannot expose stock loss valuations to ADMIN');
RESET ROLE;
UPDATE public.pos_sessions SET status='closed',closed_at=now() WHERE id=(SELECT session_id FROM antifraud_ids);
SET LOCAL ROLE authenticated;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_financial_entry_v1(receipt_je),'Closing original shift does not release a receipt in a different open shift') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_sales_day_v1(current_date),'A remaining open shift keeps the sales day private');
INSERT INTO antifraud_results(tap) SELECT is((SELECT count(*) FROM public.pos_sessions WHERE id=(SELECT receiving_session_id FROM antifraud_ids)),0::bigint,'ADMIN cannot read its own open shift through cashier permissions');
RESET ROLE;
UPDATE public.pos_sessions SET status='closed',closed_at=now() WHERE id=(SELECT receiving_session_id FROM antifraud_ids);
SET LOCAL ROLE authenticated;
INSERT INTO antifraud_results(tap) SELECT ok(public.can_view_sales_day_v1(current_date),'Closed shifts release their sales day without Owner/opname');
INSERT INTO antifraud_results(tap) SELECT ok(public.can_view_financial_entry_v1(sale_je),'Closed shift releases sale JE') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok(public.can_view_financial_entry_v1(receipt_je),'Closed receiving shift releases outstanding JE') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok(public.can_view_financial_entry_v1(float_je),'Closed shift releases its float JE') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_stock_v1(),'Shift closure never unlocks stock');
INSERT INTO antifraud_results(tap) SELECT throws_ok('SELECT public.get_stock_levels_v6()','P0003','stock_visibility_owner_required','Stock reader stays Owner only after shift closure');
RESET ROLE;

-- B2B sans droit POS, avec prix serveur, AR et facture payée encore lisible.
UPDATE public.user_permission_overrides SET is_granted=false WHERE user_profile_id=(SELECT id FROM antifraud_actors WHERE role_code='ADMIN')
 AND permission_code='pos.sale.create';
INSERT INTO public.customers(id,name,customer_type,b2b_credit_limit,b2b_current_balance)
 SELECT customer_id,'Visibility B2B fixture','b2b',NULL,0 FROM antifraud_ids;
SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM antifraud_actors WHERE role_code='ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.has_permission(auth.uid(),'pos.sale.create') AND public.has_permission(auth.uid(),'b2b.order.create'),'B2B create permission is independent of POS sale');
INSERT INTO antifraud_payload SELECT 'b2b',public.create_b2b_order_v10(customer_id,
 jsonb_build_array(jsonb_build_object('product_id',product_id,'quantity',1,'unit_price',1)),NULL,NULL,b2b_key) FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT is((value->>'total')::numeric,10000::numeric,'B2B creation uses server price') FROM antifraud_payload WHERE name='b2b';
INSERT INTO antifraud_payload SELECT 'edit',public.edit_b2b_order_v3((value->>'order_id')::uuid,
 (SELECT jsonb_agg(jsonb_build_object('id',i.id,'product_id',i.product_id,'quantity',i.quantity)) FROM public.order_items i WHERE i.order_id=(value->>'order_id')::uuid),
 'Confirmed B2B notes',(SELECT o.updated_at FROM public.orders o WHERE o.id=(value->>'order_id')::uuid),gen_random_uuid())
 FROM antifraud_payload WHERE name='b2b';
INSERT INTO antifraud_results(tap) SELECT ok(value IS NOT NULL,'ADMIN edits a B2B order without POS sale permission') FROM antifraud_payload WHERE name='edit';
INSERT INTO antifraud_payload SELECT 'pickup',public.update_b2b_pickup_v2((value->>'order_id')::uuid,current_date,true) FROM antifraud_payload WHERE name='b2b';
INSERT INTO antifraud_results(tap) SELECT ok(value IS NOT NULL,'ADMIN validates B2B delivery without POS sale permission') FROM antifraud_payload WHERE name='pickup';
INSERT INTO antifraud_payload SELECT 'payment',public.record_b2b_payment_v6((SELECT customer_id FROM antifraud_ids),10000,'transfer',
 p_idempotency_key=>(SELECT payment_key FROM antifraud_ids),p_invoice_ids=>ARRAY[(value->>'order_id')::uuid]) FROM antifraud_payload WHERE name='b2b';
INSERT INTO antifraud_results(tap) SELECT ok((public.create_b2b_order_v10(customer_id,
 jsonb_build_array(jsonb_build_object('product_id',product_id,'quantity',1,'unit_price',1)),NULL,NULL,b2b_key)->>'idempotent_replay')::boolean,
 'B2B creation retry after full payment returns its original order') FROM antifraud_ids;
INSERT INTO antifraud_results(tap) SELECT ok((public.record_b2b_payment_v6((SELECT customer_id FROM antifraud_ids),10000,'transfer',
 p_idempotency_key=>(SELECT payment_key FROM antifraud_ids),p_invoice_ids=>ARRAY[(value->>'order_id')::uuid])->>'idempotent_replay')::boolean,
 'B2B payment retry after full settlement does not charge again') FROM antifraud_payload WHERE name='b2b';
INSERT INTO antifraud_results(tap) SELECT ok(public.can_view_order_v2((value->>'order_id')::uuid),'Fully paid B2B invoice remains visible') FROM antifraud_payload WHERE name='b2b';
INSERT INTO antifraud_results(tap) SELECT ok(public.get_b2b_invoice_v3((value->>'order_id')::uuid) IS NOT NULL,'B2B PDF data remains readable after payment') FROM antifraud_payload WHERE name='b2b';
RESET ROLE;
INSERT INTO antifraud_results(tap) SELECT is((SELECT b2b_current_balance FROM public.customers WHERE id=(SELECT customer_id FROM antifraud_ids)),0::numeric,'Full B2B settlement reconciles the customer balance');
INSERT INTO antifraud_results(tap) SELECT is((SELECT count(*) FROM public.journal_entries WHERE reference_type='sale' AND reference_id=(SELECT (value->>'order_id')::uuid FROM antifraud_payload WHERE name='b2b')),0::bigint,'B2B payment creates no duplicate POS revenue JE');

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM antifraud_actors WHERE role_code='CASHIER'));
SET LOCAL ROLE authenticated;
INSERT INTO antifraud_results(tap) SELECT ok(NOT public.can_view_stock_v1(),'CASHIER never sees theoretical stock');
INSERT INTO antifraud_results(tap) SELECT is((SELECT e->>'current_stock' FROM jsonb_array_elements(public.get_operational_products_v3()) e
 WHERE e->>'id'=(SELECT product_id::text FROM antifraud_ids)),NULL::text,'CASHIER catalogue masks exact stock');
INSERT INTO antifraud_results(tap) SELECT is((SELECT (e->'display_stock'->>'quantity')::numeric FROM jsonb_array_elements(public.get_operational_products_v3()) e
 WHERE e->>'id'=(SELECT product_id::text FROM antifraud_ids)),20::numeric,'CASHIER sees the display counter');
RESET ROLE;

SELECT pg_temp.authenticate_pin((SELECT auth_user_id FROM antifraud_actors WHERE role_code='SUPER_ADMIN'));
SET LOCAL ROLE authenticated;
INSERT INTO antifraud_results(tap) SELECT ok(public.can_view_stock_v1(),'Owner retains theoretical stock visibility');
INSERT INTO antifraud_results(tap) SELECT is((SELECT (e->>'current_stock')::numeric FROM jsonb_array_elements(public.get_operational_products_v3()) e
 WHERE e->>'id'=(SELECT product_id::text FROM antifraud_ids)),19::numeric,'Owner sees the B2B-adjusted exact stock');
RESET ROLE;
INSERT INTO antifraud_results(tap) SELECT ok(NOT has_function_privilege('anon','public.submit_display_day_closing_v1(date,jsonb,uuid)','EXECUTE'),'Daily submission denies anonymous execution');
INSERT INTO antifraud_results(tap) SELECT ok(NOT has_table_privilege('authenticated','public.display_day_closing_items','SELECT'),'Raw daily rows cannot leak theoretical snapshots');
INSERT INTO antifraud_results(tap) SELECT ok(NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname ~ '^get_(sales_by_product|product_sales_lines)_v[1-4]$'),'Legacy product report bypasses are removed');
INSERT INTO antifraud_results(tap) SELECT ok(NOT has_function_privilege('anon','public.get_operational_products_v3()','EXECUTE'),'Operational catalogue denies anonymous execution');
SELECT jsonb_build_object('tap',(SELECT jsonb_agg(tap ORDER BY seq) FROM antifraud_results),
 'finish',(SELECT jsonb_agg(f) FROM finish() f)) AS results;
ROLLBACK;
