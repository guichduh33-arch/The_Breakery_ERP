BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(48);
CREATE TEMP TABLE redemption_checks(name text, passed boolean);
DO $test$
DECLARE
  actor uuid; profile uuid; shift uuid;
  category uuid:=gen_random_uuid(); customer_category uuid:=gen_random_uuid();
  customer uuid:=gen_random_uuid(); product uuid:=gen_random_uuid();
  order_one uuid; order_three uuid; item_id uuid; key uuid:=gen_random_uuid();
  paid jsonb; result jsonb; first_result jsonb; replay jsonb;
  cash numeric; part integer; returned_points integer:=0; returned_cash numeric:=0;
  refused boolean:=false; before_points integer;
  test_order uuid; test_item uuid; earned integer; blocked boolean;
  precise_order uuid; points_order uuid; void_redeemed_order uuid; points_key uuid; points_result jsonb; tax_points_order uuid;
BEGIN
  SELECT auth_user_id,id INTO actor,profile FROM public.user_profiles
    WHERE deleted_at IS NULL AND is_active AND has_permission(auth_user_id,'pos.sale.create')
      AND has_permission(auth_user_id,'payments.process') AND has_permission(auth_user_id,'pos.sale.refund')
      AND has_permission(auth_user_id,'pos.sale.void') LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'fixture: sale/payment/refund actor missing'; END IF;
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor)::text,true);
  SELECT id INTO shift FROM public.pos_sessions WHERE opened_by=profile AND status='open' LIMIT 1;
  IF shift IS NULL THEN
    INSERT INTO public.pos_sessions(opened_by,opening_cash,status) VALUES(profile,0,'open') RETURNING id INTO shift;
  END IF;
  UPDATE public.business_config SET tax_inclusive=true,tax_rate=0.1 WHERE id=1;
  UPDATE public.promotions SET is_active=false WHERE is_active;
  INSERT INTO public.categories(id,name,slug) VALUES(category,'Refund redemption fixture','rr-'||category);
  INSERT INTO public.customer_categories(id,name,slug,is_default,loyalty_enabled,points_multiplier)
    VALUES(customer_category,'Refund redemption fixture','rr-'||customer_category,false,true,1);
  INSERT INTO public.customers(id,name,customer_type,category_id,loyalty_points,lifetime_points)
    VALUES(customer,'Refund redemption fixture','retail',customer_category,10000,0);
  INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,track_inventory,is_display_item,product_type,deduct_stock)
    VALUES(product,'RR-'||product,'Refund redemption fixture',category,100000,0,false,false,'finished',false);
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',100000,'modifiers','[]'::jsonb)),
    p_payment:=jsonb_build_object('method','cash','amount',90000,'cash_received',90000,'change_given',0),
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=1000);
  order_one:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT item_id FROM public.order_items WHERE order_id=order_one;
  INSERT INTO redemption_checks VALUES('redeemed sale charges only the net payment',(paid->>'total')::numeric=90000);
  result:=public.refund_order_rpc_v14(order_one,jsonb_build_array(jsonb_build_object('order_item_id',item_id,'qty',1)),
    '[{"method":"cash","amount":90000}]','Redemption full return',profile,key,actor);
  first_result:=result;
  INSERT INTO redemption_checks VALUES
    ('full return refunds the actual payment',(result->>'total_refunded')::numeric=90000),
    ('full return restores the redeemed points',(result->>'pts_restored')::integer=1000),
    ('full return restores the customer balance',(SELECT loyalty_points=10000 FROM public.customers WHERE id=customer)),
    ('restored redeemed points do not increase lifetime points',(SELECT lifetime_points=0 FROM public.customers WHERE id=customer)),
    ('full return removes the net amount from customer spending',(SELECT total_spent=0 FROM public.customers WHERE id=customer)),
    ('refund lines carry the allocated net amount',(SELECT sum(amount)=90000 FROM public.refund_lines WHERE refund_id=(result->>'refund_id')::uuid)),
    ('redemption restoration creates one positive ledger entry',(SELECT count(*)=1 AND sum(points)=1000 FROM public.loyalty_transactions WHERE order_id=order_one AND transaction_type='refund' AND points>0));
  replay:=public.refund_order_rpc_v14(order_one,jsonb_build_array(jsonb_build_object('order_item_id',item_id,'qty',1)),
    '[{"method":"cash","amount":90000}]','Redemption full return',profile,key,actor);
  INSERT INTO redemption_checks VALUES
    ('replay returns the original result including restored points',(replay-'idempotent_replay')=(first_result-'idempotent_replay') AND (replay->>'idempotent_replay')::boolean),
    ('replay does not restore points twice',(SELECT loyalty_points=10000 FROM public.customers WHERE id=customer));
  BEGIN
    PERFORM public.refund_order_rpc_v14(order_one,jsonb_build_array(jsonb_build_object('order_item_id',item_id,'qty',1)),
      '[{"method":"cash","amount":90000}]','Duplicate return rejected',profile,gen_random_uuid(),actor);
  EXCEPTION WHEN check_violation THEN refused:=true; END;
  INSERT INTO redemption_checks VALUES('another key cannot refund the same quantity again',refused);
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',3,'unit_price',100000,'modifiers','[]'::jsonb)),
    p_payment:=jsonb_build_object('method','cash','amount',290000,'cash_received',290000,'change_given',0),
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=1000);
  order_three:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT item_id FROM public.order_items WHERE order_id=order_three;
  FOR part IN 1..3 LOOP
    cash:=CASE WHEN part=2 THEN 96600 ELSE 96700 END;
    result:=public.refund_order_rpc_v14(order_three,jsonb_build_array(jsonb_build_object('order_item_id',item_id,'qty',1)),
      jsonb_build_array(jsonb_build_object('method','cash','amount',cash)),'Fractional redemption return',profile,gen_random_uuid(),actor);
    returned_cash:=returned_cash+(result->>'total_refunded')::numeric;
    returned_points:=returned_points+(result->>'pts_restored')::integer;
    INSERT INTO redemption_checks VALUES('partial return '||part||' uses cumulative currency and point rounding',
      (result->>'total_refunded')::numeric=cash AND (result->>'pts_restored')::integer=CASE WHEN part<3 THEN 333 ELSE 334 END);
  END LOOP;
  INSERT INTO redemption_checks VALUES
    ('three returns preserve the full cash and redemption totals',returned_cash=290000 AND returned_points=1000),
    ('three returns preserve the original paid tax',(SELECT sum(tax_refunded)=(SELECT tax_amount FROM public.orders WHERE id=order_three) FROM public.refunds WHERE order_id=order_three)),
    ('all allocated refund lines reconcile with the tenders',(SELECT sum(rl.amount)=290000 FROM public.refund_lines rl JOIN public.refunds r ON r.id=rl.refund_id WHERE r.order_id=order_three)),
    ('partial restoration ledger adds exactly the redeemed points',(SELECT sum(points)=1000 FROM public.loyalty_transactions WHERE order_id=order_three AND transaction_type='refund' AND points>0));
  INSERT INTO redemption_checks VALUES
    ('fractional returns also remove every earned point',(SELECT loyalty_points=10000 FROM public.customers WHERE id=customer)),
    ('fractional returns reset earned lifetime points',(SELECT lifetime_points=0 FROM public.customers WHERE id=customer)),
    ('fractional returns reset customer net spending',(SELECT total_spent=0 FROM public.customers WHERE id=customer));
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',100000,'modifiers','[]'::jsonb)),
    p_payment:=jsonb_build_object('method','cash','amount',100000,'cash_received',100000,'change_given',0),
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=0);
  test_order:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT test_item FROM public.order_items WHERE order_id=test_order;
  SELECT loyalty_points_earned INTO earned FROM public.orders WHERE id=test_order;
  UPDATE public.customers SET loyalty_points=0 WHERE id=customer;
  blocked:=false;
  BEGIN
    PERFORM public.refund_order_rpc_v14(test_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',1)),
      '[{"method":"cash","amount":100000}]','Spent points refund blocked',profile,gen_random_uuid(),actor);
  EXCEPTION WHEN SQLSTATE 'P0020' THEN blocked:=true; END;
  INSERT INTO redemption_checks VALUES
    ('refund refuses earned points that have already been spent',blocked),
    ('refused refund creates no refund row',(SELECT count(*)=0 FROM public.refunds WHERE order_id=test_order)),
    ('refused refund leaves customer balance unchanged',(SELECT loyalty_points=0 FROM public.customers WHERE id=customer));
  blocked:=false;
  BEGIN
    PERFORM public.void_order_rpc_v13(test_order,'Spent points void blocked',profile,actor,gen_random_uuid());
  EXCEPTION WHEN SQLSTATE 'P0020' THEN blocked:=true; END;
  INSERT INTO redemption_checks VALUES
    ('void cannot bypass the unavailable points rule',blocked),
    ('refused void leaves the order paid and creates no refund',(SELECT status IN('paid','completed') FROM public.orders WHERE id=test_order)
      AND (SELECT count(*)=0 FROM public.refunds WHERE order_id=test_order));
  UPDATE public.customers SET loyalty_points=earned WHERE id=customer;
  PERFORM public.void_order_rpc_v13(test_order,'Points available void succeeds',profile,actor,gen_random_uuid());
  INSERT INTO redemption_checks VALUES
    ('void succeeds once the earned points are available',(SELECT loyalty_points=0 FROM public.customers WHERE id=customer)),
    ('void reverses customer net spending',(SELECT total_spent=0 FROM public.customers WHERE id=customer));
  UPDATE public.customers SET loyalty_points=10000 WHERE id=customer;
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',100000,'modifiers','[]'::jsonb)),
    p_payment:=jsonb_build_object('method','cash','amount',90000,'cash_received',90000,'change_given',0),
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=1000);
  test_order:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT test_item FROM public.order_items WHERE order_id=test_order;
  SELECT loyalty_points_earned INTO earned FROM public.orders WHERE id=test_order;
  UPDATE public.customers SET loyalty_points=0 WHERE id=customer;
  result:=public.refund_order_rpc_v14(test_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',1)),
    '[{"method":"cash","amount":90000}]','Restoration covers earned points',profile,gen_random_uuid(),actor);
  INSERT INTO redemption_checks VALUES
    ('restored redemption can cover the earned points to reverse',(SELECT loyalty_points=1000-earned FROM public.customers WHERE id=customer)),
    ('restoration-first ledger never records a negative running balance',NOT EXISTS(SELECT 1 FROM public.loyalty_transactions
      WHERE order_id=test_order AND transaction_type='refund' AND points_balance_after<0));
  -- La quantité SQL persistée et la base de calcul doivent partager les mêmes trois décimales.
  UPDATE public.customers SET loyalty_points=10000 WHERE id=customer;
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'modifiers','[]'::jsonb)),
    p_payment:='{"method":"cash","amount":90000,"cash_received":90000,"change_given":0}',
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=1000);
  precise_order:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT test_item FROM public.order_items WHERE order_id=precise_order;
  result:=public.refund_order_rpc_v14(precise_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.3335)),
    '[{"method":"cash","amount":30100}]','Quantity precision first return',profile,gen_random_uuid(),actor);
  INSERT INTO redemption_checks VALUES('quantity is normalized before money and points allocation',
    (result->>'total_refunded')::numeric=30100 AND (result->>'pts_restored')::integer=334
      AND (SELECT qty=0.334 FROM public.refund_lines WHERE refund_id=(result->>'refund_id')::uuid));
  result:=public.refund_order_rpc_v14(precise_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.666)),
    '[{"method":"cash","amount":59900}]','Quantity precision final return',profile,gen_random_uuid(),actor);
  INSERT INTO redemption_checks VALUES('normalized fractional returns restore every point',
    (result->>'pts_restored')::integer=666 AND (SELECT sum(loyalty_points_restored)=1000 FROM public.refunds WHERE order_id=precise_order));
  UPDATE public.products SET retail_price=10000 WHERE id=product;
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'modifiers','[]'::jsonb)),
    p_payment:='{"method":"cash","amount":9000,"cash_received":9000,"change_given":0}',
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=100);
  points_order:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT test_item FROM public.order_items WHERE order_id=points_order;
  result:=public.refund_order_rpc_v14(points_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.999)),
    '[{"method":"cash","amount":9000}]','Currency rounded before last point',profile,gen_random_uuid(),actor);
  points_key:=gen_random_uuid();
  points_result:=public.refund_order_rpc_v14(points_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.001)),
    '[]','Final return restores remaining point',profile,points_key,actor);
  INSERT INTO redemption_checks VALUES
    ('final points-only return restores its point without cash',(points_result->>'total_refunded')::numeric=0 AND (points_result->>'pts_restored')::integer=1),
    ('points-only return creates no payment row',(SELECT count(*)=0 FROM public.refund_payments WHERE refund_id=(points_result->>'refund_id')::uuid)),
    ('points-only return preserves sale cash and point totals',(SELECT sum(total)=9000 AND sum(loyalty_points_restored)=100 FROM public.refunds WHERE order_id=points_order));
  replay:=public.refund_order_rpc_v14(points_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.001)),
    '[]','Final return restores remaining point',profile,points_key,actor);
  INSERT INTO redemption_checks VALUES('points-only return replay keeps the initial result',(replay-'idempotent_replay')=points_result);
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'modifiers','[]'::jsonb)),
    p_payment:='{"method":"cash","amount":9000,"cash_received":9000,"change_given":0}',
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=100);
  void_redeemed_order:=(paid->>'order_id')::uuid;
  PERFORM public.void_order_rpc_v13(void_redeemed_order,'Void restores redemption books',profile,actor,gen_random_uuid());
  UPDATE public.products SET retail_price=100000 WHERE id=product;
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'modifiers','[]'::jsonb)),
    p_payment:='{"method":"cash","amount":90000,"cash_received":90000,"change_given":0}',
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=1000);
  tax_points_order:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT test_item FROM public.order_items WHERE order_id=tax_points_order;
  PERFORM public.refund_order_rpc_v14(tax_points_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.115)),
    '[{"method":"cash","amount":10400}]','Tax rounding first return',profile,gen_random_uuid(),actor);
  result:=public.refund_order_rpc_v14(tax_points_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.001)),
    '[]','Tax rounding without another tender',profile,gen_random_uuid(),actor);
  INSERT INTO redemption_checks VALUES('tax can be reclassified on a points-only partial return',
    (result->>'total_refunded')::numeric=0 AND (result->>'tax_refunded')::numeric=100 AND (result->>'pts_restored')::integer=1);
  PERFORM public.refund_order_rpc_v14(tax_points_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',0.884)),
    '[{"method":"cash","amount":79600}]','Tax rounding final return',profile,gen_random_uuid(),actor);
  INSERT INTO redemption_checks VALUES('tax reclassification preserves final cash tax and points totals',
    (SELECT sum(total)=90000 AND sum(tax_refunded)=8200 AND sum(loyalty_points_restored)=1000 FROM public.refunds WHERE order_id=tax_points_order));
  UPDATE public.customer_categories SET loyalty_enabled=false WHERE id=customer_category;
  UPDATE public.customers SET loyalty_points=2000 WHERE id=customer;
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',100000,'modifiers','[]'::jsonb)),
    p_payment:=jsonb_build_object('method','cash','amount',90000,'cash_received',90000,'change_given',0),
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=1000);
  test_order:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT test_item FROM public.order_items WHERE order_id=test_order;
  SELECT loyalty_points_earned INTO earned FROM public.orders WHERE id=test_order;
  result:=public.refund_order_rpc_v14(test_order,jsonb_build_array(jsonb_build_object('order_item_id',test_item,'qty',1)),
    '[{"method":"cash","amount":90000}]','No earned points full refund',profile,gen_random_uuid(),actor);
  INSERT INTO redemption_checks VALUES
    ('disabled earning still restores existing redeemed points',earned=0 AND (SELECT loyalty_points=2000 FROM public.customers WHERE id=customer)),
    ('refund updates spending even when no points were earned',(SELECT total_spent=0 FROM public.customers WHERE id=customer));
  paid:=public.complete_order_with_payment_v31(p_session_id:=shift,p_order_type:='take_out',
    p_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'unit_price',100000,'modifiers','[]'::jsonb)),
    p_payment:=jsonb_build_object('method','cash','amount',100000,'cash_received',100000,'change_given',0),
    p_idempotency_key:=gen_random_uuid(),p_customer_id:=customer,p_loyalty_points_redeemed:=0);
  test_order:=(paid->>'order_id')::uuid;
  SELECT id INTO STRICT test_item FROM public.order_items WHERE order_id=test_order;
  SELECT loyalty_points_earned INTO earned FROM public.orders WHERE id=test_order;
  PERFORM public.void_order_rpc_v13(test_order,'No earned points full void',profile,actor,gen_random_uuid());
  INSERT INTO redemption_checks VALUES('void updates spending even when no points were earned',
    (SELECT total_spent=0 FROM public.customers WHERE id=customer));
  UPDATE public.customers SET loyalty_points=0 WHERE id=customer;
  SELECT id INTO item_id FROM public.order_items WHERE order_id=order_one;
  replay:=public.refund_order_rpc_v14(order_one,jsonb_build_array(jsonb_build_object('order_item_id',item_id,'qty',1)),
    '[{"method":"cash","amount":90000}]','Redemption full return',profile,key,actor);
  INSERT INTO redemption_checks VALUES('confirmed replay ignores later changes in point availability',
    (replay-'idempotent_replay')=(first_result-'idempotent_replay') AND (SELECT loyalty_points=0 FROM public.customers WHERE id=customer));
  SET CONSTRAINTS ALL IMMEDIATE;
  INSERT INTO redemption_checks VALUES('refund journal headers match their debit and credit lines',NOT EXISTS(
    SELECT je.id FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id
    WHERE je.reference_type='sale_refund' AND je.reference_id IN(SELECT r.id FROM public.refunds r JOIN public.orders o ON o.id=r.order_id WHERE o.customer_id=customer)
    GROUP BY je.id,je.total_debit,je.total_credit HAVING sum(jl.debit)<>je.total_debit OR sum(jl.credit)<>je.total_credit));

  INSERT INTO redemption_checks VALUES('full and fractional refunds cancel the original redemption accounts',NOT EXISTS(
    SELECT jl.account_id FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id
    WHERE (je.reference_id IN(order_one,order_three,precise_order,points_order,tax_points_order) OR je.reference_id IN(SELECT id FROM public.refunds WHERE order_id IN(order_one,order_three,precise_order,points_order,tax_points_order)))
      AND jl.account_id IN(resolve_mapping_account('LOYALTY_LIABILITY'),resolve_mapping_account('SALE_DISCOUNT'))
    GROUP BY jl.account_id HAVING sum(jl.debit)<>sum(jl.credit)));
  INSERT INTO redemption_checks VALUES('void cancels both original redemption accounts exactly once',
    (SELECT count(*)=1 FROM public.journal_entries WHERE reference_type='sale_void' AND reference_id=void_redeemed_order)
    AND NOT EXISTS(SELECT jl.account_id FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id
      WHERE je.reference_id=void_redeemed_order AND jl.account_id IN(resolve_mapping_account('LOYALTY_LIABILITY'),resolve_mapping_account('SALE_DISCOUNT'))
      GROUP BY jl.account_id HAVING sum(jl.debit)<>sum(jl.credit)));
  INSERT INTO redemption_checks VALUES('fractional monetary redemption restoration sums to the original value',
    (SELECT sum(loyalty_redemption_restored_amount)=10000 FROM public.refunds WHERE order_id=order_three));

  INSERT INTO redemption_checks VALUES('refund journal entries remain balanced',NOT EXISTS(
    SELECT 1 FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id
    WHERE je.reference_id IN(SELECT id FROM public.orders WHERE customer_id=customer) OR je.reference_id IN(SELECT r.id FROM public.refunds r JOIN public.orders o ON o.id=r.order_id WHERE o.customer_id=customer)
    GROUP BY je.id HAVING sum(jl.debit)<>sum(jl.credit)));
  INSERT INTO redemption_checks VALUES('refund remains service-role only',
    NOT has_function_privilege('anon','public.refund_order_rpc_v14(uuid,jsonb,jsonb,text,uuid,uuid,uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.refund_order_rpc_v14(uuid,jsonb,jsonb,text,uuid,uuid,uuid)','EXECUTE'));
END;
$test$;
SELECT ok(COALESCE(passed,false),name) FROM redemption_checks;
SELECT * FROM finish();
ROLLBACK;
