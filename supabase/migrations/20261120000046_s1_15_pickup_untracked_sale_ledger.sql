-- Retrait B2B : une ligne non suivie sans recette conserve son mouvement de coût, sans bouger le compteur.
CREATE OR REPLACE FUNCTION public.update_b2b_pickup_v4(p_order_id uuid, p_pickup_date date DEFAULT NULL::date, p_mark_delivered boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid:=auth.uid();
 v_profile uuid;
 v_customer uuid;
 v_order public.orders%ROWTYPE;
 v_item record;
 v_cons record;
 v_need record;
 v_product public.products%ROWTYPE;
 v_needs jsonb:='[]'::jsonb;
 v_now timestamptz:=now();
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
 IF NOT public.has_permission(v_uid,'b2b.read') OR NOT public.has_permission(v_uid,'b2b.order.create') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
 END IF;
 SELECT id INTO v_profile FROM public.user_profiles WHERE auth_user_id=v_uid AND deleted_at IS NULL;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE='P0001'; END IF;
 SELECT customer_id INTO v_customer FROM public.orders WHERE id=p_order_id AND order_type='b2b';
 PERFORM id FROM public.customers WHERE id=v_customer FOR UPDATE;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.order_type<>'b2b' THEN
  RAISE EXCEPTION 'b2b_order_not_found' USING ERRCODE='P0002';
 END IF;
 IF v_order.financial_import_document_id IS NOT NULL THEN
  RAISE EXCEPTION 'financial_import_requires_dedicated_workflow' USING ERRCODE='P0003';
 END IF;
 IF v_order.status='voided' THEN RAISE EXCEPTION 'order_voided'; END IF;
 IF p_mark_delivered IS NULL THEN RAISE EXCEPTION 'delivery_action_required'; END IF;
 IF v_order.b2b_delivered_at IS NOT NULL THEN
  IF NOT p_mark_delivered THEN RAISE EXCEPTION 'order_already_delivered'; END IF;
  IF v_order.b2b_stock_consumed_at IS NULL THEN RAISE EXCEPTION 'b2b_stock_state_inconsistent'; END IF;
  RETURN jsonb_build_object('order_id',v_order.id,'pickup_date',v_order.pickup_date,
   'b2b_delivered_at',v_order.b2b_delivered_at);
 END IF;
 IF NOT p_mark_delivered AND p_pickup_date IS NULL THEN RAISE EXCEPTION 'pickup_date_required'; END IF;
 IF v_order.b2b_stock_consumed_at IS NOT NULL THEN RAISE EXCEPTION 'b2b_stock_state_inconsistent'; END IF;

 IF p_mark_delivered THEN
  IF v_order.status NOT IN ('b2b_pending','paid') THEN RAISE EXCEPTION 'order_not_collectable'; END IF;
  PERFORM public.check_fiscal_period_open(current_date);
  PERFORM id FROM public.order_items WHERE order_id=p_order_id ORDER BY id FOR UPDATE;
  IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=p_order_id) OR EXISTS(
    SELECT 1 FROM public.order_items WHERE order_id=p_order_id AND
     (is_cancelled OR combo_components IS NOT NULL OR coalesce(modifiers,'[]'::jsonb)<>'[]'::jsonb)) THEN
   RAISE EXCEPTION 'order_requires_dedicated_workflow';
  END IF;
  -- Résoudre la consommation au retrait, avec arrêt sur les semi-finis suivis.
  FOR v_item IN SELECT oi.product_id,oi.quantity,p.unit,coalesce(p.track_inventory,true) tracked,p.deduct_stock
   FROM public.order_items oi JOIN public.products p ON p.id=oi.product_id
   WHERE oi.order_id=p_order_id ORDER BY oi.id LOOP
   IF v_item.tracked OR NOT coalesce(v_item.deduct_stock,false) THEN
    v_needs:=v_needs||jsonb_build_object('product_id',v_item.product_id,'quantity',v_item.quantity,'unit',coalesce(v_item.unit,'pcs'));
   ELSIF v_item.deduct_stock THEN
    FOR v_cons IN SELECT * FROM public._resolve_recipe_consumption_v2(v_item.product_id,v_item.quantity) LOOP
     v_needs:=v_needs||jsonb_build_object('product_id',v_cons.product_id,'quantity',v_cons.qty_base,'unit',v_cons.unit);
    END LOOP;
   END IF;
  END LOOP;
  -- Agréger lignes et ingrédients partagés avant toute sortie. Tous les produits
  -- sont verrouillés dans le même ordre pour deux retraits concurrents.
  FOR v_need IN SELECT product_id,unit,sum(quantity) quantity
    FROM jsonb_to_recordset(v_needs) AS x(product_id uuid,unit text,quantity numeric)
    GROUP BY product_id,unit ORDER BY product_id,unit LOOP
   IF v_need.quantity IS NULL OR v_need.quantity<=0 OR v_need.quantity::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION 'invalid_stock_consumption';
   END IF;
   SELECT * INTO STRICT v_product FROM public.products WHERE id=v_need.product_id FOR UPDATE;
   IF coalesce(v_product.track_inventory,true) AND coalesce(v_product.current_stock,0)<v_need.quantity THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
   END IF;
   INSERT INTO public.b2b_order_stock_consumptions(order_id,product_id,unit,quantity,inventory_tracked)
    VALUES(p_order_id,v_need.product_id,v_need.unit,v_need.quantity,coalesce(v_product.track_inventory,true));
  END LOOP;
  FOR v_need IN SELECT * FROM public.b2b_order_stock_consumptions
   WHERE order_id=p_order_id ORDER BY product_id,unit LOOP
   PERFORM public._record_sale_stock_v1(v_need.product_id,v_need.quantity,p_order_id,v_profile,
    'B2B pickup',p_unit:=v_need.unit,p_allow_negative:=false);
  END LOOP;
 END IF;

 UPDATE public.orders SET pickup_date=coalesce(p_pickup_date,pickup_date),
  b2b_delivered_at=CASE WHEN p_mark_delivered THEN v_now ELSE NULL END,
  b2b_stock_consumed_at=CASE WHEN p_mark_delivered THEN v_now ELSE NULL END,
  recipe_consumption_revision=CASE WHEN p_mark_delivered THEN 2 ELSE recipe_consumption_revision END,
  updated_at=v_now WHERE id=p_order_id RETURNING * INTO v_order;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 VALUES(v_profile,CASE WHEN p_mark_delivered THEN 'b2b.order.delivered' ELSE 'b2b.order.pickup_updated' END,
  'orders',p_order_id,jsonb_build_object('pickup_date',v_order.pickup_date,
   'b2b_delivered_at',v_order.b2b_delivered_at,'stock_consumed_at',v_order.b2b_stock_consumed_at));
 RETURN jsonb_build_object('order_id',v_order.id,'pickup_date',v_order.pickup_date,
  'b2b_delivered_at',v_order.b2b_delivered_at);
EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE='P0002' AND SQLERRM ~* '(insufficient.*stock|have )' THEN
  RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
 END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.update_b2b_pickup_v4(uuid,date,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_b2b_pickup_v4(uuid,date,boolean) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.update_b2b_pickup_v3(uuid,date,boolean);
