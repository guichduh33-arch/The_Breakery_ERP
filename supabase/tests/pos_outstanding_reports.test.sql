-- Contrat financier : vente reconnue une fois, versements datés indépendamment.
-- À exécuter uniquement sur dev, dans cette transaction annulée.
BEGIN;
SELECT no_plan();
CREATE TEMP TABLE report_baselines(day date PRIMARY KEY,result jsonb);
DO $fixture$
DECLARE a uuid; u uuid; s uuid; c uuid; o uuid; p uuid; d date:=current_date-2;
BEGIN
 SELECT id,auth_user_id INTO a,u FROM public.user_profiles
 WHERE role_code='SUPER_ADMIN' AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL LIMIT 1;
 IF a IS NULL THEN RAISE EXCEPTION 'fixture: SUPER_ADMIN required'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u)::text,true);
 INSERT INTO report_baselines SELECT d,public.get_daily_sales_v5(d::text,d::text);
 INSERT INTO report_baselines SELECT current_date,public.get_daily_sales_v5(current_date::text,current_date::text);
 SELECT id INTO s FROM public.pos_sessions WHERE opened_by=a ORDER BY opened_at DESC LIMIT 1;
 IF s IS NULL THEN RAISE EXCEPTION 'fixture: session required'; END IF;
 INSERT INTO public.customers(name,retail_credit_limit) VALUES('Outstanding reports fixture',1000000) RETURNING id INTO c;
 INSERT INTO public.products(sku,name,category_id,retail_price,unit,cost_price,current_stock,track_inventory,is_test)
 VALUES('OUT-REPORT-'||gen_random_uuid(),'Reports fixture',(SELECT id FROM public.categories LIMIT 1),100000,'pcs',0,100,true,false) RETURNING id INTO p;
 INSERT INTO public.orders(order_number,order_type,status,created_via,session_id,served_by,customer_id,
 subtotal,tax_amount,total,created_at)
 VALUES('OUT-REPORT-'||gen_random_uuid(),'take_out','pending_payment','pos',s,a,c,100000,9100,100000,d-1) RETURNING id INTO o;
 INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,kitchen_status,modifiers)
 VALUES(o,p,'Reports fixture',100000,1,100000,'pending','[]');
 UPDATE public.orders SET outstanding_at=d+interval '12 hours' WHERE id=o;
 INSERT INTO public.order_payments(order_id,method,amount,paid_at,session_id) VALUES(o,'qris',30000,current_date+interval '12 hours',s);
 PERFORM set_config('reports.order',o::text,true);
 PERFORM set_config('reports.customer',c::text,true);
END $fixture$;
SELECT ok(NOT has_schema_privilege('authenticated','reporting_private','USAGE'),'private projection not exposed');
SELECT ok(NOT has_function_privilege('anon','public.get_customer_recognized_orders_v2(uuid)','EXECUTE'),'anonymous customer analytics refused');
SELECT has_function('public','get_daily_sales_v5',ARRAY['text','text'],'previous Daily Sales RPC remains available');
SELECT has_function('public','get_daily_sales_v5',ARRAY['text','text'],'new Daily Sales RPC available');
SELECT is((public.get_daily_sales_v5(day::text,day::text)->'summary'->>'total')::numeric-
 (result->'summary'->>'total')::numeric,100000::numeric,'Outstanding belongs to recognition day')
 FROM report_baselines WHERE day=current_date-2;
SELECT is((public.get_daily_sales_v5(day::text,day::text)->'summary'->>'receipts_total')::numeric,
 (result->'summary'->>'receipts_total')::numeric,'recognition creates no false receipt')
 FROM report_baselines WHERE day=current_date-2;
SELECT is((public.get_daily_sales_v5(day::text,day::text)->'summary'->>'total')::numeric,
 (result->'summary'->>'total')::numeric,'partial receipt creates no new revenue')
 FROM report_baselines WHERE day=current_date;
SELECT is((public.get_daily_sales_v5(day::text,day::text)->'summary'->>'receipts_total')::numeric-
 (result->'summary'->>'receipts_total')::numeric,30000::numeric,'partial receipt counted on payment day')
 FROM report_baselines WHERE day=current_date;
SELECT is((SELECT recognized_at::date FROM public.get_customer_recognized_orders_v2(current_setting('reports.customer')::uuid)
 WHERE id=current_setting('reports.order')::uuid),current_date-2,'customer analytics uses recognition day');
SELECT is((SELECT status::text FROM public.orders WHERE id=current_setting('reports.order')::uuid),'pending_payment','reporting leaves unpaid status unchanged');
SELECT is((SELECT paid_at FROM public.orders WHERE id=current_setting('reports.order')::uuid),NULL::timestamptz,'reporting leaves paid_at null');
CREATE TEMP TABLE payment_baseline AS SELECT public.get_pos_payment_breakdown_v3(current_date,current_date) result;
DO $settle$
DECLARE o uuid:=current_setting('reports.order')::uuid; s uuid;
BEGIN
 SELECT session_id INTO s FROM public.orders WHERE id=o;
 INSERT INTO public.order_payments(order_id,method,amount,paid_at,session_id)
 VALUES(o,'transfer',70000,current_date+interval '13 hours',s);
 PERFORM set_config('breakery.outstanding_settlement','true',true);
 UPDATE public.orders SET status='paid',paid_at=current_date+interval '13 hours' WHERE id=o;
END $settle$;
SELECT is((public.get_daily_sales_v5(day::text,day::text)->'summary'->>'total')::numeric-
 (result->'summary'->>'total')::numeric,100000::numeric,'full settlement does not move recognition day')
 FROM report_baselines WHERE day=current_date-2;
SELECT is((public.get_daily_sales_v5(day::text,day::text)->'summary'->>'total')::numeric,
 (result->'summary'->>'total')::numeric,'full settlement does not duplicate revenue')
 FROM report_baselines WHERE day=current_date;
SELECT is((public.get_pos_payment_breakdown_v3(current_date,current_date)->>'total_amount')::numeric-
 (result->>'total_amount')::numeric,70000::numeric,'payment report counts additional real receipt only')
 FROM payment_baseline;
SELECT * FROM finish();
ROLLBACK;
