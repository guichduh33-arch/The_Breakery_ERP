BEGIN;
\ir helpers/b2b_edit.sql
CREATE TEMP TABLE stock_edit_checks(name text, passed boolean);
DO $test$
DECLARE
 v_uid uuid; v_customer uuid; v_product uuid; v_recipe uuid; v_material uuid;
 v_order uuid; v_line uuid; v_revision timestamptz; v_items jsonb; v_result jsonb;
 v_stock numeric; v_count bigint; v_period uuid; v_status text;
BEGIN
 SELECT auth_user_id INTO STRICT v_uid FROM public.user_profiles WHERE deleted_at IS NULL AND is_active
  AND public.has_permission(auth_user_id,'b2b.read') AND public.has_permission(auth_user_id,'pos.sale.create')
  AND public.has_permission(auth_user_id,'b2b.payment.record') AND public.has_permission(auth_user_id,'b2b.order.cancel') LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_uid)::text,true);
 INSERT INTO public.customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
  VALUES('B2B stock edit fixture','b2b',NULL,0) RETURNING id INTO v_customer;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,is_display_item,unit)
  VALUES('EDIT-'||gen_random_uuid(),'Edit display fixture',(SELECT id FROM public.categories LIMIT 1),10000,10,true,false,true,'pcs') RETURNING id INTO v_product;
 UPDATE public.display_stock SET quantity=10 WHERE product_id=v_product;
 v_result := pg_temp.create_b2b_edit_fixture(v_customer,jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),NULL,NULL,gen_random_uuid());
 v_order := (v_result->>'order_id')::uuid;
 SELECT id INTO v_line FROM public.order_items WHERE order_id=v_order;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_items := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',4));
 v_result := public.edit_b2b_order_v2(v_order,v_items,'Display increase',v_revision,gen_random_uuid());
 INSERT INTO stock_edit_checks SELECT 'B2B increase updates general stock only',p.current_stock=6 AND ds.quantity=10
  FROM public.products p JOIN public.display_stock ds ON ds.product_id=p.id WHERE p.id=v_product;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_items := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',1));
 v_result := public.edit_b2b_order_v2(v_order,v_items,'Display decrease',v_revision,gen_random_uuid());
 INSERT INTO stock_edit_checks SELECT 'B2B decrease restores general stock only',p.current_stock=9 AND ds.quantity=10
  FROM public.products p JOIN public.display_stock ds ON ds.product_id=p.id WHERE p.id=v_product;
 -- L'annulation après édition doit rendre exactement la quantité encore facturée.
 PERFORM public.cancel_b2b_order_v3(v_order,'Cancel edited fixture',gen_random_uuid());
 INSERT INTO stock_edit_checks SELECT 'cancel edited order restores original stocks',p.current_stock=10 AND ds.quantity=10
  FROM public.products p JOIN public.display_stock ds ON ds.product_id=p.id WHERE p.id=v_product;
 INSERT INTO stock_edit_checks SELECT 'cancel edited order reconciles AR',b2b_current_balance=0 FROM public.customers WHERE id=v_customer;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,unit)
  VALUES('EDIT-'||gen_random_uuid(),'Edit material kg',(SELECT id FROM public.categories LIMIT 1),10000,10,true,false,'kg') RETURNING id INTO v_material;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,unit)
  VALUES('EDIT-'||gen_random_uuid(),'Edit recipe fixture',(SELECT id FROM public.categories LIMIT 1),10000,0,false,true,'pcs') RETURNING id INTO v_recipe;
 INSERT INTO public.recipes(product_id,material_id,quantity,unit) VALUES(v_recipe,v_material,100,'g');
 v_result := pg_temp.create_b2b_edit_fixture(v_customer,jsonb_build_array(jsonb_build_object('product_id',v_recipe,'quantity',2)),NULL,NULL,gen_random_uuid());
 v_order := (v_result->>'order_id')::uuid;
 SELECT id INTO v_line FROM public.order_items WHERE order_id=v_order;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_items := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_recipe,'quantity',4));
 v_result := public.edit_b2b_order_v2(v_order,v_items,'Recipe increase',v_revision,gen_random_uuid());
 INSERT INTO stock_edit_checks SELECT 'recipe delta converts grams to kg',current_stock=9.6 FROM public.products WHERE id=v_material;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_items := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_recipe,'quantity',1));
 v_result := public.edit_b2b_order_v2(v_order,v_items,'Recipe decrease',v_revision,gen_random_uuid());
 INSERT INTO stock_edit_checks SELECT 'recipe decrease restores material in base units',current_stock=9.9 FROM public.products WHERE id=v_material;
 SELECT count(*) INTO v_count FROM public.stock_movements WHERE reference_id=v_order;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_result := public.edit_b2b_order_v2(v_order,v_items,'Notes only',v_revision,gen_random_uuid());
 INSERT INTO stock_edit_checks SELECT 'notes-only edit has no stock movements',count(*)=v_count FROM public.stock_movements WHERE reference_id=v_order;
 -- Nouveau produit : le prix négocié serveur prime sur une valeur client forgée.
 INSERT INTO public.customer_product_prices(customer_id,product_id,price) VALUES(v_customer,v_product,7000);
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_items := v_items || jsonb_build_object('product_id',v_product,'quantity',1,'unit_price',1);
 v_result := public.edit_b2b_order_v2(v_order,v_items,'Negotiated addition',v_revision,gen_random_uuid());
 INSERT INTO stock_edit_checks SELECT 'added product uses negotiated server price',unit_price=7000 AND line_total=7000
  FROM public.order_items WHERE order_id=v_order AND product_id=v_product;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 SELECT jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'quantity',quantity)) INTO v_items FROM public.order_items WHERE order_id=v_order;
 BEGIN
  PERFORM public.edit_b2b_order_v2(v_order,jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_recipe,'quantity',-1)),NULL,v_revision,gen_random_uuid());
  INSERT INTO stock_edit_checks VALUES('negative quantity rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO stock_edit_checks VALUES('negative quantity rejected',true); END;
 BEGIN
  PERFORM public.edit_b2b_order_v2(v_order,jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'product_id',v_recipe,'quantity',1)),NULL,v_revision,gen_random_uuid());
  INSERT INTO stock_edit_checks VALUES('foreign line rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO stock_edit_checks VALUES('foreign line rejected',SQLERRM='invalid_order_item'); END;
 BEGIN
  PERFORM public.edit_b2b_order_v2(v_order,v_items||v_items,NULL,v_revision,gen_random_uuid());
  INSERT INTO stock_edit_checks VALUES('duplicate line rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO stock_edit_checks VALUES('duplicate line rejected',true); END;
 -- Période fermée : même une modification de notes est refusée.
 SELECT id,status INTO v_period,v_status FROM public.fiscal_periods WHERE current_date BETWEEN period_start AND period_end LIMIT 1;
 UPDATE public.fiscal_periods SET status='closed' WHERE id=v_period;
 BEGIN
  PERFORM public.edit_b2b_order_v2(v_order,v_items,'Closed period',v_revision,gen_random_uuid());
  INSERT INTO stock_edit_checks VALUES('closed fiscal period rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0004' THEN INSERT INTO stock_edit_checks VALUES('closed fiscal period rejected',true); END;
 UPDATE public.fiscal_periods SET status=v_status WHERE id=v_period;
 PERFORM pg_temp.pay_b2b_edit_fixture(v_customer,(v_result->>'total')::numeric,'transfer',p_invoice_ids=>ARRAY[v_order],p_idempotency_key=>gen_random_uuid());
 BEGIN
  PERFORM public.edit_b2b_order_v2(v_order,v_items,'After full payment',v_revision,gen_random_uuid());
  INSERT INTO stock_edit_checks VALUES('fully paid order rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO stock_edit_checks VALUES('fully paid order rejected',SQLERRM='order_not_editable'); END;
END $test$;
SELECT plan((SELECT count(*)::integer FROM stock_edit_checks));
SELECT ok(passed,name) FROM stock_edit_checks;
SELECT * FROM finish();
ROLLBACK;
