BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(45);
CREATE TEMP TABLE gift_checks(name text, passed boolean);
DO $test$
DECLARE
  actor uuid; profile uuid; shift uuid; category uuid := gen_random_uuid();
  paid_product uuid := gen_random_uuid(); gift_product uuid := gen_random_uuid();
  combo uuid := gen_random_uuid(); parent uuid := gen_random_uuid(); child uuid := gen_random_uuid();
  promo uuid := gen_random_uuid(); payload jsonb; chosen jsonb; evaluated jsonb;
  result jsonb; replay jsonb; fired jsonb; key uuid; v_paid_order_id uuid;
  payment jsonb; charged numeric; refused boolean; before_count bigint; after_stock numeric;
  raw_product uuid := gen_random_uuid();
  limited_auth uuid := gen_random_uuid(); limited_profile uuid := gen_random_uuid();
BEGIN
  SELECT auth_user_id, id INTO actor, profile FROM public.user_profiles
    WHERE deleted_at IS NULL AND has_permission(auth_user_id, 'pos.sale.create')
      AND has_permission(auth_user_id, 'payments.process')
      AND has_permission(auth_user_id, 'pos.sale.void') LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'fixture: missing sale/payment actor'; END IF;
  PERFORM set_config('request.jwt.claim.sub', actor::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', actor)::text, true);
  SELECT id INTO shift FROM public.pos_sessions WHERE opened_by=profile AND status='open' LIMIT 1;
  IF shift IS NULL THEN
    INSERT INTO public.pos_sessions(opened_by, opening_cash, status) VALUES(profile, 0, 'open') RETURNING id INTO shift;
  END IF;
  INSERT INTO public.categories(id, name, slug) VALUES(category, 'Payment gift fixture', 'gift-'||category);
  INSERT INTO public.products(id, sku, name, category_id, retail_price, current_stock, track_inventory, is_display_item, product_type)
    VALUES(paid_product, 'GIFT-PAID-'||paid_product, 'Paid fixture', category, 1000, 100, true, false, 'finished'),
      (gift_product, 'GIFT-AWARD-'||gift_product, 'Gift fixture', category, 250, 100, true, false, 'finished'),
      (combo, 'GIFT-COMBO-'||combo, 'Combo fixture', category, 250, 0, false, false, 'combo'),
      (parent, 'GIFT-PARENT-'||parent, 'Parent fixture', category, 250, 0, false, false, 'finished');
  INSERT INTO public.products(id, sku, name, category_id, retail_price, current_stock, track_inventory,
    parent_product_id, variant_label, variant_axis, is_active)
    VALUES(child, 'GIFT-CHILD-'||child, 'Child fixture', category, 250, 100, true, parent, 'Small', 'size', false);
  UPDATE public.promotions SET is_active=false WHERE is_active;
  INSERT INTO public.promotions(id, name, slug, type, scope, bogo_buy_quantity, bogo_get_quantity,
    bogo_get_product_id, bogo_trigger_product_ids, is_active)
    VALUES(promo, 'Gift at payment fixture', 'gift-payment-'||promo, 'bogo', 'cart', 2, 1,
      gift_product, ARRAY[paid_product], true);
  chosen:=jsonb_build_array(jsonb_build_object('promotion_id',promo,'amount',0));
  payload:=jsonb_build_array(jsonb_build_object('product_id',paid_product,'quantity',1,'unit_price',1000,'modifiers','[]'::jsonb));
  evaluated:=public.evaluate_promotions_v3(payload, NULL, 1000);
  INSERT INTO gift_checks VALUES('BOGO below buy quantity grants nothing',jsonb_array_length(evaluated->'applied_promotions')=0);
  payload:=jsonb_set(payload,'{0,quantity}','2');
  evaluated:=public.evaluate_promotions_v3(payload,NULL,2000);
  INSERT INTO gift_checks VALUES
    ('BOGO threshold grants exactly one free item',(evaluated#>>'{applied_promotions,0,free_items,0,quantity}')::numeric=1),
    ('BOGO has no second monetary discount',(evaluated#>>'{applied_promotions,0,discount_amount}')::numeric=0);
  evaluated:=public.evaluate_promotions_v3(jsonb_set(payload,'{0,quantity}','4'),NULL,4000);
  INSERT INTO gift_checks VALUES('BOGO quantity formula is unchanged',(evaluated#>>'{applied_promotions,0,free_items,0,quantity}')::numeric=2);
  fired:=public.fire_counter_order_v11(gen_random_uuid(),shift,payload);
  INSERT INTO gift_checks VALUES
    ('fire persists only ordered items',(SELECT count(*)=1 AND bool_and(NOT is_promo_gift) FROM public.order_items WHERE order_items.order_id=(fired->>'order_id')::uuid)),
    ('fire does not consume gift stock',(SELECT current_stock=100 FROM public.products WHERE id=gift_product));
  refused:=false;
  BEGIN
    PERFORM public.fire_counter_order_v11(gen_random_uuid(),shift,payload||jsonb_build_array(
      jsonb_build_object('product_id',gift_product,'quantity',1,'unit_price',0,'is_promo_gift',true,'promotion_id',promo)));
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_gifts_acquired_at_payment:%'; END;
  INSERT INTO gift_checks VALUES('fire refuses a client claim of an acquired gift',refused);
  SELECT total INTO charged FROM public._pb1_split_v1(2000);
  payment:=jsonb_build_object('method','cash','amount',charged,'cash_received',charged,'change_given',0);
  key:=gen_random_uuid();
  result:=public.complete_order_with_payment_v30(shift,'take_out',payload,payment,key,p_promotions:=chosen);
  v_paid_order_id:=(result->>'order_id')::uuid;
  INSERT INTO gift_checks VALUES
    ('server creates the omitted gift for direct payment',(SELECT count(*)=1 AND sum(quantity)=1 AND bool_and(unit_price=0 AND line_total=0 AND is_locked) FROM public.order_items WHERE order_items.order_id=v_paid_order_id AND is_promo_gift)),
    ('paid subtotal is not discounted by the value of the gift',(result->>'subtotal')::numeric=2000 AND (result->>'total')::numeric=charged),
    ('paid snapshot includes gift identity',EXISTS(SELECT 1 FROM jsonb_array_elements(result#>'{order_snapshot,items}') i WHERE (i->>'is_promo_gift')::boolean AND (i->>'promotion_id')::uuid=promo)),
    ('gift stock is consumed once',(SELECT current_stock=99 FROM public.products WHERE id=gift_product)),
    ('zero amount gift consumes one application',(SELECT count(*)=1 AND sum(amount)=0 FROM public.promotion_applications WHERE promotion_id=promo));
  UPDATE public.promotions SET is_active=false WHERE id=promo;
  replay:=public.complete_order_with_payment_v30(shift,'take_out','[]',payment,key,p_promotions:='[]');
  INSERT INTO gift_checks VALUES
    ('replay returns original persisted gifts after promotion removal',replay->'order_snapshot'=result->'order_snapshot'),
    ('replay does not consume more gift stock',(SELECT current_stock=99 FROM public.products WHERE id=gift_product));
  UPDATE public.promotions SET is_active=true WHERE id=promo;
  result:=public.complete_order_with_payment_v30(shift,'take_out',payload||jsonb_build_array(
    jsonb_build_object('product_id',gift_product,'quantity',99,'unit_price',0,'is_promo_gift',true,'promotion_id',promo),
    jsonb_build_object('product_id',gift_product,'quantity',99,'unit_price',0,'is_promo_gift',true,'promotion_id',promo)),
    payment,gen_random_uuid(),p_promotions:=chosen);
  INSERT INTO gift_checks VALUES('client gift quantities and duplicates cannot grant extra items',
    (SELECT count(*)=1 AND sum(quantity)=1 FROM public.order_items WHERE order_items.order_id=(result->>'order_id')::uuid AND is_promo_gift));
  refused:=false;
  BEGIN
    PERFORM public.complete_order_with_payment_v30(shift,'take_out',payload,payment,gen_random_uuid(),p_promotions:=chosen||chosen);
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_declaration_duplicate:%'; END;
  INSERT INTO gift_checks VALUES('duplicate promotion declarations are refused',refused);
  result:=public.pay_existing_order_v22((fired->>'order_id')::uuid,payment,p_idempotency_key:=gen_random_uuid(),p_promotions:=chosen);
  INSERT INTO gift_checks VALUES('payment of fired order creates the gift',
    (SELECT count(*)=1 AND sum(quantity)=1 FROM public.order_items WHERE order_items.order_id=(fired->>'order_id')::uuid AND is_promo_gift));
  -- Les droits de préparation viennent du serveur ; aucun choix implicite.
  INSERT INTO public.product_modifiers(product_id,group_name,group_required,group_type,option_label,is_active)
    VALUES(gift_product,'Required answer',true,'single_select','Choose me',true);
  refused:=false;
  BEGIN PERFORM public._assert_payment_gift_eligible_v1(gift_product);
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_gift_requires_configuration:%'; END;
  INSERT INTO gift_checks VALUES('required product answer rejects automatic gift',refused);
  UPDATE public.product_modifiers SET is_active=false WHERE product_id=gift_product;
  INSERT INTO public.product_modifiers(category_id,group_name,group_required,group_type,option_label,is_active)
    VALUES(category,'Category answer',true,'single_select','Choose category',true);
  refused:=false;
  BEGIN PERFORM public._assert_payment_gift_eligible_v1(gift_product);
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_gift_requires_configuration:%'; END;
  INSERT INTO gift_checks VALUES('inherited required answer rejects automatic gift',refused);
  INSERT INTO public.product_modifiers(product_id,group_name,group_required,group_type,option_label,is_active)
    VALUES(gift_product,'Category answer',false,'single_select','Optional override',true);
  PERFORM public._assert_payment_gift_eligible_v1(gift_product);
  INSERT INTO gift_checks VALUES('optional product group overrides required category group',true);
  UPDATE public.product_modifiers SET is_active=false WHERE category_id=category;
  refused:=false;
  BEGIN PERFORM public._assert_payment_gift_eligible_v1(parent);
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_gift_requires_configuration:%'; END;
  INSERT INTO gift_checks VALUES('a parent is refused even when all children are hidden',refused);
  UPDATE public.products SET is_active=true WHERE id=child;
  PERFORM public._assert_payment_gift_eligible_v1(child);
  INSERT INTO gift_checks VALUES('an explicitly selected variant SKU without required choices is allowed',true);
  refused:=false;
  BEGIN PERFORM public._assert_payment_gift_eligible_v1(combo);
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_gift_requires_configuration:%'; END;
  INSERT INTO gift_checks VALUES('combo composition cannot be invented for a gift',refused);
  refused:=false;
  BEGIN UPDATE public.promotions SET bogo_get_product_id=combo WHERE id=promo;
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_gift_requires_configuration:%'; END;
  INSERT INTO gift_checks VALUES('backoffice writes cannot activate an incompatible gift',refused);
  SELECT count(*) INTO before_count FROM public.orders;
  SELECT current_stock INTO after_stock FROM public.products WHERE id=gift_product;
  UPDATE public.products SET is_active=false WHERE id=gift_product;
  refused:=false;
  BEGIN PERFORM public.complete_order_with_payment_v30(shift,'take_out',payload,payment,gen_random_uuid(),p_promotions:=chosen);
  EXCEPTION WHEN check_violation THEN refused:=SQLERRM LIKE 'promo_gift_unavailable:%'; END;
  INSERT INTO gift_checks VALUES('unavailable gift rejects the entire payment',refused
    AND (SELECT count(*)=before_count FROM public.orders)
    AND (SELECT current_stock=after_stock FROM public.products WHERE id=gift_product));
  UPDATE public.products SET is_active=true,retail_price=0 WHERE id=gift_product;
  evaluated:=public.evaluate_promotions_v3(payload,NULL,2000);
  INSERT INTO gift_checks VALUES('zero-retail gift still uses the same BOGO quantity',
    (evaluated#>>'{applied_promotions,0,free_items,0,quantity}')::numeric=1);
  -- Un cadeau historique marqué n'est ni remplacé ni doublonné.
  fired:=public.fire_counter_order_v11(gen_random_uuid(),shift,payload);
  INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,
    modifiers,is_promo_gift,promotion_id,is_locked,kitchen_status,sent_to_kitchen_at)
    VALUES((fired->>'order_id')::uuid,gift_product,'Historic gift',0,1,0,'[]',true,promo,true,'pending',now());
  result:=public.pay_existing_order_v22((fired->>'order_id')::uuid,payment,p_idempotency_key:=gen_random_uuid(),p_promotions:=chosen);
  INSERT INTO gift_checks VALUES('historical marked gift is retained without duplicate',
    (SELECT count(*)=1 AND bool_and(name_snapshot='Historic gift') FROM public.order_items WHERE order_items.order_id=(fired->>'order_id')::uuid AND is_promo_gift));
  FOR before_count IN 1..2 LOOP
    fired:=public.fire_counter_order_v11(gen_random_uuid(),shift,payload);
    INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,
      modifiers,is_promo_gift,promotion_id,is_locked,kitchen_status,sent_to_kitchen_at)
      VALUES((fired->>'order_id')::uuid,gift_product,'Already prepared gift',0,1,0,'[]',true,promo,true,'pending',now());
    IF before_count=1 THEN UPDATE public.products SET is_active=false WHERE id=gift_product;
    ELSE
      INSERT INTO public.product_modifiers(product_id,group_name,group_required,group_type,option_label,is_active)
        VALUES(gift_product,'New requirement',true,'single_select','Required now',true);
    END IF;
    result:=public.pay_existing_order_v22((fired->>'order_id')::uuid,payment,p_idempotency_key:=gen_random_uuid(),p_promotions:=chosen);
    INSERT INTO gift_checks VALUES(CASE WHEN before_count=1 THEN 'inactive historical gift does not block payment'
      ELSE 'new required choices do not invalidate a historical prepared gift' END,
      (SELECT count(*)=1 FROM public.order_items WHERE order_items.order_id=(fired->>'order_id')::uuid AND is_promo_gift));
    UPDATE public.products SET is_active=true WHERE id=gift_product;
    UPDATE public.product_modifiers SET is_active=false WHERE product_id=gift_product AND group_name='New requirement';
  END LOOP;
  fired:=public.fire_counter_order_v11(gen_random_uuid(),shift,payload);
  INSERT INTO public.order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,
    modifiers,is_promo_gift,is_locked,kitchen_status,sent_to_kitchen_at)
    VALUES((fired->>'order_id')::uuid,gift_product,'Historic zero line',0,1,0,'[]',false,true,'pending',now());
  result:=public.pay_existing_order_v22((fired->>'order_id')::uuid,payment,p_idempotency_key:=gen_random_uuid());
  INSERT INTO gift_checks VALUES
    ('historical zero-price line is retained',(SELECT count(*)=1 FROM public.order_items WHERE order_items.order_id=(fired->>'order_id')::uuid AND name_snapshot='Historic zero line' AND unit_price=0)),
    ('zero price alone never becomes a gift',(SELECT count(*)=0 FROM public.order_items WHERE order_items.order_id=(fired->>'order_id')::uuid AND is_promo_gift));
  UPDATE public.promotions SET is_active=false WHERE id=promo;
  promo:=gen_random_uuid();
  INSERT INTO public.promotions(id,name,slug,type,scope,gift_product_id,gift_qty,max_uses,is_active)
    VALUES(promo,'Free quantity fixture','free-quantity-'||promo,'free_product','cart',gift_product,2,1,true);
  chosen:=jsonb_build_array(jsonb_build_object('promotion_id',promo,'amount',0));
  key:=gen_random_uuid();
  result:=public.complete_order_with_payment_v30(shift,'take_out',payload,payment,key,p_promotions:=chosen);
  INSERT INTO gift_checks VALUES
    ('free_product preserves the configured gift quantity',(SELECT sum(quantity)=2 FROM public.order_items WHERE order_items.order_id=(result->>'order_id')::uuid AND is_promo_gift)),
    ('zero-amount free_product consumes its global cap',(SELECT count(*)=1 FROM public.promotion_applications WHERE promotion_id=promo));
  refused:=false;
  BEGIN PERFORM public.complete_order_with_payment_v30(shift,'take_out',payload,payment,gen_random_uuid(),p_promotions:=chosen);
  EXCEPTION WHEN check_violation THEN refused:=true; END;
  INSERT INTO gift_checks VALUES('a second zero-amount gift cannot exceed its cap',refused);
  replay:=public.complete_order_with_payment_v30(shift,'take_out','[]',payment,key,p_promotions:=chosen);
  INSERT INTO gift_checks VALUES('replay after cap consumption returns the first gift',
    replay->'order_snapshot'=result->'order_snapshot' AND (SELECT count(*)=1 FROM public.promotion_applications WHERE promotion_id=promo));
  SELECT current_stock INTO after_stock FROM public.products WHERE id=gift_product;
  PERFORM public.void_order_rpc_v13(p_order_id:=(result->>'order_id')::uuid,
    p_reason:='Gift rollback fixture',p_authorized_by:=profile,
    p_acting_auth_user_id:=actor,p_idempotency_key:=gen_random_uuid());
  INSERT INTO gift_checks VALUES('void restores the actual gift stock',
    (SELECT current_stock=after_stock+2 FROM public.products WHERE id=gift_product));
  evaluated:=public.evaluate_promotions_v3(payload,NULL,2000);
  INSERT INTO gift_checks VALUES('void releases the promotion usage as before',jsonb_array_length(evaluated->'applied_promotions')=1);
  UPDATE public.promotions SET max_uses=NULL WHERE id=promo;
  INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,track_inventory,unit)
    VALUES(raw_product,'GIFT-RAW-'||raw_product,'Gift recipe material',category,0,100,true,'pcs');
  UPDATE public.products SET track_inventory=false,deduct_stock=true WHERE id=gift_product;
  INSERT INTO public.recipes(product_id,material_id,quantity,unit,is_active)
    VALUES(gift_product,raw_product,3,'pcs',true);
  SELECT current_stock INTO after_stock FROM public.products WHERE id=gift_product;
  result:=public.complete_order_with_payment_v30(shift,'take_out',payload,payment,gen_random_uuid(),p_promotions:=chosen);
  INSERT INTO gift_checks VALUES
    ('recipe gift consumes its configured ingredient quantity',(SELECT current_stock=94 FROM public.products WHERE id=raw_product)),
    ('recipe gift does not also consume the untracked finished stock',(SELECT current_stock=after_stock FROM public.products WHERE id=gift_product));
  UPDATE public.products SET deduct_stock=false WHERE id=gift_product;
  result:=public.complete_order_with_payment_v30(shift,'take_out',payload,payment,gen_random_uuid(),p_promotions:=chosen);
  INSERT INTO gift_checks VALUES('gift without stock deduction consumes no ingredients',(SELECT current_stock=94 FROM public.products WHERE id=raw_product));
  UPDATE public.products SET track_inventory=true,is_display_item=true WHERE id=gift_product;
  INSERT INTO public.display_stock(product_id,quantity) VALUES(gift_product,0)
    ON CONFLICT(product_id) DO UPDATE SET quantity=0;
  SELECT count(*) INTO before_count FROM public.orders;
  refused:=false;
  BEGIN PERFORM public.complete_order_with_payment_v30(shift,'take_out',payload,payment,gen_random_uuid(),p_promotions:=chosen);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN refused:=true; END;
  INSERT INTO gift_checks VALUES('insufficient display gift stock rolls back the entire sale',
    refused AND (SELECT count(*)=before_count FROM public.orders));
  INSERT INTO gift_checks VALUES('internal gift builder cannot be called by clients',
    NOT has_function_privilege('anon','public._payment_gift_items_v1(jsonb,jsonb)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public._payment_gift_items_v1(jsonb,jsonb)','EXECUTE')
      AND NOT has_function_privilege('anon','public._pos_order_snapshot_data_v1(uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public._pos_order_snapshot_data_v1(uuid)','EXECUTE'));
  fired:=public.fire_counter_order_v11(gen_random_uuid(),shift,payload);
  INSERT INTO auth.users(id) VALUES(limited_auth);
  INSERT INTO public.user_profiles(id,auth_user_id,role_code,employee_code,full_name,pin_hash,is_active)
    VALUES(limited_profile,limited_auth,'CASHIER','GIFT-'||left(limited_profile::text,8),'Payment only fixture',hash_pin('854721'),true);
  INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    SELECT limited_profile,code,code='payments.process','Payment-only transactional fixture' FROM public.permissions;
  PERFORM set_config('request.jwt.claim.sub',limited_auth::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',limited_auth)::text,true);
  key:=gen_random_uuid();
  result:=public.pay_existing_order_v22((fired->>'order_id')::uuid,payment,p_idempotency_key:=key);
  INSERT INTO gift_checks VALUES('payment-only operator can still pay an existing order',
    result->'order_snapshot'->>'order_id'=fired->>'order_id');
  replay:=public.pay_existing_order_v22((fired->>'order_id')::uuid,payment,p_idempotency_key:=key);
  INSERT INTO gift_checks VALUES('payment-only operator can replay the confirmed payment',
    (replay->>'idempotent_replay')::boolean AND replay->'order_snapshot'=result->'order_snapshot');
  refused:=false;
  BEGIN PERFORM public.get_pos_order_snapshot_v2((fired->>'order_id')::uuid);
  EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
  INSERT INTO gift_checks VALUES('public order reader keeps its existing creation-permission gate',refused);
END;
$test$;
SELECT ok(COALESCE(passed,false),name) FROM gift_checks;
SELECT * FROM finish();
ROLLBACK;
