BEGIN;
CREATE TEMP TABLE pickup_checks (name text, passed boolean);
DO $test$
DECLARE
 v_uid uuid; v_denied uuid; v_customer uuid; v_product uuid;
 v_first uuid; v_second uuid; v_total numeric; v_time timestamptz;
 v_order public.orders%ROWTYPE; v_result jsonb;
BEGIN
 SELECT auth_user_id INTO STRICT v_uid FROM public.user_profiles
 WHERE deleted_at IS NULL AND is_active
 AND public.has_permission(auth_user_id,'b2b.read')
 AND public.has_permission(auth_user_id,'pos.sale.create')
 AND public.has_permission(auth_user_id,'b2b.payment.record') LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_uid)::text,true);
 INSERT INTO public.customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
 VALUES('Pickup regression fixture','b2b',NULL,0) RETURNING id INTO v_customer;
 SELECT id INTO STRICT v_product FROM public.products
 WHERE deleted_at IS NULL AND retail_price > 0 AND track_inventory AND current_stock > 3 LIMIT 1;
 v_result := public.create_b2b_order_v7(v_customer,
 jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),NULL,CURRENT_DATE+1,gen_random_uuid());
 v_first := (v_result->>'order_id')::uuid;
 v_total := (v_result->>'total')::numeric;
 INSERT INTO pickup_checks SELECT 'creation stores planned pickup', pickup_date = CURRENT_DATE+1 AND b2b_delivered_at IS NULL
 FROM public.orders WHERE id=v_first;
 PERFORM public.update_b2b_pickup_v1(v_first,CURRENT_DATE+2,false);
 INSERT INTO pickup_checks SELECT 'reschedule preserves unpaid status',pickup_date=CURRENT_DATE+2 AND status='b2b_pending' AND paid_at IS NULL
 FROM public.orders WHERE id=v_first;
 PERFORM public.update_b2b_pickup_v1(v_first,NULL,true);
 SELECT * INTO v_order FROM public.orders WHERE id=v_first;
 v_time := v_order.b2b_delivered_at;
 INSERT INTO pickup_checks VALUES('collection does not pay order',v_time IS NOT NULL AND v_order.paid_at IS NULL AND v_order.status='b2b_pending');
 PERFORM public.update_b2b_pickup_v1(v_first,NULL,true);
 INSERT INTO pickup_checks SELECT 'repeat collection is idempotent',b2b_delivered_at=v_time
 AND (SELECT count(*) FROM public.audit_logs WHERE entity_id=v_first AND action='b2b.order.delivered')=1
 FROM public.orders WHERE id=v_first;
 PERFORM public.record_b2b_payment_v3(v_customer,v_total/2,'transfer',p_invoice_ids=>ARRAY[v_first],p_idempotency_key=>gen_random_uuid());
 INSERT INTO pickup_checks SELECT 'partial payment preserves delivery and balance',b2b_delivered_at=v_time AND outstanding=v_total/2 AND paid_at IS NULL
 FROM public.view_b2b_invoices WHERE invoice_id=v_first;
 PERFORM public.record_b2b_payment_v3(v_customer,v_total/2,'transfer',p_invoice_ids=>ARRAY[v_first],p_idempotency_key=>gen_random_uuid());
 INSERT INTO pickup_checks SELECT 'full payment preserves delivery',b2b_delivered_at=v_time AND outstanding=0 AND paid_at IS NOT NULL AND order_status='paid'
 FROM public.view_b2b_invoices WHERE invoice_id=v_first;
 v_result := public.create_b2b_order_v7(v_customer,
 jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),NULL,CURRENT_DATE+1,gen_random_uuid());
 v_second := (v_result->>'order_id')::uuid;
 PERFORM public.record_b2b_payment_v3(v_customer,(v_result->>'total')::numeric,'transfer',p_invoice_ids=>ARRAY[v_second],p_idempotency_key=>gen_random_uuid());
 INSERT INTO pickup_checks SELECT 'prepayment does not confirm pickup',paid_at IS NOT NULL AND b2b_delivered_at IS NULL FROM public.orders WHERE id=v_second;
 PERFORM public.update_b2b_pickup_v1(v_second,NULL,true);
 INSERT INTO pickup_checks SELECT 'paid order can be collected',paid_at IS NOT NULL AND status='paid' AND b2b_delivered_at IS NOT NULL FROM public.orders WHERE id=v_second;
 BEGIN
  PERFORM public.update_b2b_pickup_v1(v_second,CURRENT_DATE+5,false);
  INSERT INTO pickup_checks VALUES('delivered order cannot be rescheduled',false);
 EXCEPTION WHEN raise_exception THEN
  INSERT INTO pickup_checks VALUES('delivered order cannot be rescheduled',SQLERRM='order_already_delivered');
 END;
 SELECT auth_user_id INTO STRICT v_denied FROM public.user_profiles WHERE deleted_at IS NULL AND is_active
 AND NOT public.has_permission(auth_user_id,'b2b.read') LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_denied::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_denied)::text,true);
 BEGIN
  PERFORM public.update_b2b_pickup_v1(v_first,NULL,true);
  INSERT INTO pickup_checks VALUES('unauthorized user rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0003' THEN
  INSERT INTO pickup_checks VALUES('unauthorized user rejected',true);
 END;
END $test$;
INSERT INTO pickup_checks VALUES('anonymous execute denied',NOT has_function_privilege('anon','public.update_b2b_pickup_v1(uuid,date,boolean)','EXECUTE'));
INSERT INTO pickup_checks SELECT 'invoice view respects RLS',reloptions @> ARRAY['security_invoker=true'] FROM pg_class WHERE oid='public.view_b2b_invoices'::regclass;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pickup_checks WHERE passed IS DISTINCT FROM true) THEN
 RAISE EXCEPTION 'Pickup regression failed: %',(SELECT string_agg(name,', ') FROM pickup_checks WHERE passed IS DISTINCT FROM true);
 END IF;
END $$;
SELECT plan((SELECT count(*)::integer FROM pickup_checks));
SELECT ok(passed,name) FROM pickup_checks;
SELECT * FROM finish();
ROLLBACK;
