-- ADR-036 : parcours publics création / édition / annulation, sans effet vitrine.
-- Toutes les fixtures et mutations sont annulées ; aucune donnée métier conservée.
BEGIN;
\ir helpers/b2b_edit.sql
CREATE TEMP TABLE channel_stock_checks(name text, passed boolean);
DO $test$
DECLARE
 v_uid uuid; v_customer uuid; v_product uuid; v_recipe uuid;
 v_order uuid; v_line uuid; v_revision timestamptz; v_result jsonb;
 v_key uuid; v_items jsonb; v_display numeric; v_initial numeric;
 v_count bigint; v_before numeric; v_case integer;
BEGIN
 SELECT auth_user_id INTO STRICT v_uid FROM public.user_profiles
 WHERE deleted_at IS NULL AND is_active
   AND public.has_permission(auth_user_id,'b2b.read')
   AND public.has_permission(auth_user_id,'pos.sale.create')
   AND public.has_permission(auth_user_id,'b2b.order.cancel') LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_uid)::text,true);
 INSERT INTO public.customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
 VALUES('Independent display fixture','b2b',NULL,0) RETURNING id INTO v_customer;
 UPDATE public.business_config SET allow_negative_stock=true;

 -- Même contrat avec vitrine vide, absente ou positive, et un produit différent par cas.
 FOR v_case IN 0..2 LOOP
  INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,
    track_inventory,deduct_stock,is_display_item,unit)
  VALUES('CHANNEL-'||gen_random_uuid(),'Independent display fixture',
    (SELECT id FROM public.categories LIMIT 1),10000,10,true,false,true,'pcs')
  RETURNING id INTO v_product;
  v_initial := CASE WHEN v_case=2 THEN 7 ELSE 0 END;
  IF v_case=1 THEN
   DELETE FROM public.display_stock WHERE product_id=v_product;
  ELSE
   UPDATE public.display_stock SET quantity=v_initial WHERE product_id=v_product;
  END IF;
  v_items := jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2));
  v_key := gen_random_uuid();
  v_result := pg_temp.create_b2b_edit_fixture(v_customer,v_items,NULL,NULL,v_key);
  v_order := (v_result->>'order_id')::uuid;
  INSERT INTO channel_stock_checks SELECT 'create deducts general stock, display case '||v_case,
   current_stock=8 FROM public.products WHERE id=v_product;
  SELECT count(*) INTO v_count FROM public.stock_movements WHERE reference_id=v_order;
  v_result := pg_temp.create_b2b_edit_fixture(v_customer,v_items,NULL,NULL,v_key);
  INSERT INTO channel_stock_checks SELECT 'create replay is stock-neutral, display case '||v_case,
   (v_result->>'idempotent_replay')::boolean AND count(*)=v_count
   FROM public.stock_movements WHERE reference_id=v_order;
  SELECT id INTO v_line FROM public.order_items WHERE order_id=v_order;
  SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
  v_items := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',4));
  v_result := public.edit_b2b_order_v2(v_order,v_items,NULL,v_revision,gen_random_uuid());
  INSERT INTO channel_stock_checks SELECT 'edit increase deducts general only, case '||v_case,
   current_stock=6 FROM public.products WHERE id=v_product;
  SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
  -- La hausse qui dépasserait le général est atomiquement refusée, même avec flag négatif.
  BEGIN
   PERFORM public.edit_b2b_order_v2(v_order,
    jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',11)),
    NULL,v_revision,gen_random_uuid());
   INSERT INTO channel_stock_checks VALUES('edit oversell rejected, case '||v_case,false);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
   INSERT INTO channel_stock_checks VALUES('edit oversell rejected, case '||v_case,true);
  END;
  INSERT INTO channel_stock_checks SELECT 'failed edit leaves general unchanged, case '||v_case,
   current_stock=6 FROM public.products WHERE id=v_product;
  v_items := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',1));
  v_result := public.edit_b2b_order_v2(v_order,v_items,NULL,v_revision,gen_random_uuid());
  INSERT INTO channel_stock_checks SELECT 'edit decrease restores general only, case '||v_case,
   current_stock=9 FROM public.products WHERE id=v_product;
  PERFORM public.cancel_b2b_order_v3(v_order,'Independent display test',gen_random_uuid());
  INSERT INTO channel_stock_checks SELECT 'cancel restores general stock, case '||v_case,
   current_stock=10 FROM public.products WHERE id=v_product;
  INSERT INTO channel_stock_checks SELECT 'display quantity and existence unchanged, case '||v_case,
   CASE WHEN v_case=1 THEN NOT EXISTS(SELECT 1 FROM public.display_stock WHERE product_id=v_product)
    ELSE (SELECT quantity=v_initial FROM public.display_stock WHERE product_id=v_product) END;
  INSERT INTO channel_stock_checks SELECT 'no display movement across full B2B lifecycle, case '||v_case,
   count(*)=0 FROM public.display_movements WHERE product_id=v_product;
 END LOOP;

 -- Un ingrédient suivi en stock peut aussi être un article vitrine ; la recette B2B
 -- consomme son général, sans exiger de vitrine ni de stock propre au produit vendu.
 UPDATE public.display_stock SET quantity=0 WHERE product_id=v_product;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,
    track_inventory,deduct_stock,is_display_item,unit)
 VALUES('CHANNEL-'||gen_random_uuid(),'B2B recipe fixture',
   (SELECT id FROM public.categories LIMIT 1),10000,0,false,true,false,'pcs')
 RETURNING id INTO v_recipe;
 INSERT INTO public.recipes(product_id,material_id,quantity,unit) VALUES(v_recipe,v_product,2,'pcs');
 v_result := pg_temp.create_b2b_edit_fixture(v_customer,
   jsonb_build_array(jsonb_build_object('product_id',v_recipe,'quantity',2)),NULL,NULL,gen_random_uuid());
 v_order := (v_result->>'order_id')::uuid;
 INSERT INTO channel_stock_checks SELECT 'recipe consumes displayed ingredient general stock',
   current_stock=6 FROM public.products WHERE id=v_product;
 PERFORM public.cancel_b2b_order_v3(v_order,'Independent recipe display test',gen_random_uuid());
 INSERT INTO channel_stock_checks SELECT 'recipe cancellation restores general stock',
   current_stock=10 FROM public.products WHERE id=v_product;
 INSERT INTO channel_stock_checks SELECT 'recipe sale and cancellation leave display unchanged',
   quantity=0 AND NOT EXISTS(SELECT 1 FROM public.display_movements WHERE product_id=v_product)
   FROM public.display_stock WHERE product_id=v_product;
 UPDATE public.products SET current_stock=0 WHERE id=v_product;
 BEGIN
  PERFORM pg_temp.create_b2b_edit_fixture(v_customer,
   jsonb_build_array(jsonb_build_object('product_id',v_recipe,'quantity',1)),NULL,NULL,gen_random_uuid());
  INSERT INTO channel_stock_checks VALUES('recipe rejects missing general stock despite negative flag',false);
 EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO channel_stock_checks VALUES('recipe rejects missing general stock despite negative flag',true);
 END;
END $test$;
SELECT plan((SELECT count(*)::integer FROM channel_stock_checks));
SELECT ok(passed,name) FROM channel_stock_checks;
SELECT * FROM finish();
ROLLBACK;
