-- Édition B2B avant remise/paiement ; les écarts sont comptabilisés sans réécrire la vente.
CREATE TABLE public.b2b_order_edit_keys (
 idempotency_key uuid PRIMARY KEY,
 order_id uuid NOT NULL REFERENCES public.orders(id),
 actor_id uuid NOT NULL REFERENCES public.user_profiles(id),
 request jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.b2b_order_edit_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.b2b_order_edit_keys FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.edit_b2b_order_v1(
 p_order_id uuid, p_items jsonb, p_notes text,
 p_expected_updated_at timestamptz, p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
 v_uid uuid := auth.uid();
 v_actor uuid;
 v_customer uuid;
 v_order public.orders%ROWTYPE;
 v_existing public.b2b_order_edit_keys%ROWTYPE;
 v_request jsonb;
 v_before jsonb;
 v_old_notes text;
 v_after jsonb;
 v_lines jsonb := '[]'::jsonb;
 v_line record;
 v_item public.order_items%ROWTYPE;
 v_product public.products%ROWTYPE;
 v_stock record;
 v_cons record;
 v_quantity numeric;
 v_price numeric;
 v_total numeric(14,2) := 0;
 v_delta numeric(14,2);
 v_balance numeric(14,2);
 v_credit jsonb;
 v_je uuid;
 v_ar uuid;
 v_revenue uuid;
 v_result jsonb;
 v_allow_negative boolean;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
 IF NOT public.has_permission(v_uid,'b2b.read') OR NOT public.has_permission(v_uid,'pos.sale.create') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
 END IF;
 SELECT id INTO v_actor FROM public.user_profiles WHERE auth_user_id=v_uid AND deleted_at IS NULL;
 IF v_actor IS NULL THEN RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE='P0001'; END IF;
 IF p_idempotency_key IS NULL OR p_expected_updated_at IS NULL THEN
  RAISE EXCEPTION 'edit_revision_and_key_required' USING ERRCODE='P0001';
 END IF;
 v_request := jsonb_build_object('order_id',p_order_id,'items',p_items,'notes',p_notes,'revision',p_expected_updated_at);
 PERFORM pg_advisory_xact_lock(hashtextextended('b2b-edit:'||p_idempotency_key::text,0));
 SELECT * INTO v_existing FROM public.b2b_order_edit_keys WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_existing.actor_id<>v_actor OR v_existing.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE='P0001';
  END IF;
  RETURN v_existing.result || jsonb_build_object('idempotent_replay',true);
 END IF;

 -- Même ordre de verrous que le règlement : client puis facture.
 SELECT customer_id INTO v_customer FROM public.orders WHERE id=p_order_id AND order_type='b2b';
 IF v_customer IS NULL THEN RAISE EXCEPTION 'b2b_order_not_found' USING ERRCODE='P0002'; END IF;
 SELECT b2b_current_balance INTO v_balance FROM public.customers
  WHERE id=v_customer AND customer_type='b2b' AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
 v_old_notes := v_order.notes;
 IF v_order.customer_id IS DISTINCT FROM v_customer OR v_order.status<>'b2b_pending'
    OR v_order.b2b_delivered_at IS NOT NULL OR v_order.paid_at IS NOT NULL THEN
  RAISE EXCEPTION 'order_not_editable' USING ERRCODE='P0001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.b2b_payment_allocations WHERE invoice_id=p_order_id)
    OR EXISTS(SELECT 1 FROM public.order_payments WHERE order_id=p_order_id)
    OR EXISTS(SELECT 1 FROM public.refunds WHERE order_id=p_order_id) THEN
  RAISE EXCEPTION 'order_has_payments' USING ERRCODE='P0011';
 END IF;
 IF v_order.financial_import_document_id IS NOT NULL OR v_order.outstanding_at IS NOT NULL THEN
  RAISE EXCEPTION 'order_requires_dedicated_workflow' USING ERRCODE='P0001';
 END IF;
 IF v_order.updated_at IS DISTINCT FROM p_expected_updated_at THEN
  RAISE EXCEPTION 'order_changed_reload' USING ERRCODE='P0001';
 END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' THEN
  RAISE EXCEPTION 'items_required' USING ERRCODE='P0001';
 END IF;
 IF jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>500 OR length(coalesce(p_notes,''))>10000 THEN
  RAISE EXCEPTION 'invalid_edit_payload' USING ERRCODE='P0001';
 END IF;
 PERFORM public.check_fiscal_period_open(current_date);
 PERFORM id FROM public.order_items WHERE order_id=p_order_id FOR UPDATE;
 -- Le parcours B2B standard ne comporte ni remise, ni combo, ni envoi cuisine.
 IF v_order.tax_amount<>0 OR coalesce(v_order.discount_amount,0)<>0 OR coalesce(v_order.promotion_total,0)<>0
    OR EXISTS(SELECT 1 FROM public.order_items WHERE order_id=p_order_id AND (
      is_cancelled OR is_locked OR sent_to_kitchen_at IS NOT NULL OR kitchen_status<>'pending'
      OR coalesce(modifiers,'[]'::jsonb)<>'[]'::jsonb OR combo_components IS NOT NULL
      OR coalesce(discount_amount,0)<>0 OR is_promo_gift)) THEN
  RAISE EXCEPTION 'order_requires_dedicated_workflow' USING ERRCODE='P0001';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(oi) ORDER BY oi.id),'[]'::jsonb) INTO v_before
  FROM public.order_items oi WHERE order_id=p_order_id;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) AS x(id uuid,product_id uuid,quantity numeric)
   WHERE quantity IS NULL OR quantity<=0 OR quantity::text IN ('NaN','Infinity','-Infinity')
      OR quantity<>round(quantity,3) OR quantity>9999999.999 OR product_id IS NULL)
   OR EXISTS(SELECT id FROM jsonb_to_recordset(p_items) AS x(id uuid) WHERE id IS NOT NULL GROUP BY id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'invalid_quantity_or_item' USING ERRCODE='P0001';
 END IF;
 FOR v_line IN SELECT * FROM jsonb_to_recordset(p_items) AS x(id uuid,product_id uuid,quantity numeric) LOOP
  SELECT * INTO v_product FROM public.products WHERE id=v_line.product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;
  IF v_line.id IS NOT NULL THEN
   SELECT * INTO v_item FROM public.order_items WHERE id=v_line.id AND order_id=p_order_id;
   IF NOT FOUND OR v_item.product_id<>v_line.product_id THEN
    RAISE EXCEPTION 'invalid_order_item' USING ERRCODE='P0001';
   END IF;
   -- Une quantité modifiée conserve le tarif déjà convenu sur la ligne.
   v_price := v_item.unit_price;
  ELSE
   IF NOT v_product.is_active OR v_product.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'product_not_available' USING ERRCODE='P0002';
   END IF;
   v_price := public._resolve_b2b_line_price_v1(v_customer,v_line.product_id);
  END IF;
  IF v_price IS NULL OR v_price<0 THEN RAISE EXCEPTION 'price_unresolved' USING ERRCODE='P0002'; END IF;
  v_quantity := v_line.quantity;
  v_total := v_total + public.round_idr(v_price*v_quantity);
  v_lines := v_lines || jsonb_build_object('id',coalesce(v_line.id,gen_random_uuid()),
   'product_id',v_line.product_id,'quantity',v_quantity,'unit_price',v_price,
   'line_total',public.round_idr(v_price*v_quantity),'name_snapshot',coalesce(v_item.name_snapshot,v_product.name));
  v_item := NULL;
 END LOOP;
 IF v_total<=0 THEN RAISE EXCEPTION 'invalid_total' USING ERRCODE='P0001'; END IF;
 v_delta := v_total-v_order.total;
 IF v_delta>0 THEN
  v_credit := public.validate_b2b_credit_limit_v1(v_customer,v_delta);
  IF NOT (v_credit->>'allowed')::boolean THEN
   RAISE EXCEPTION 'credit_limit_exceeded' USING ERRCODE='P0011';
  END IF;
 END IF;
 IF v_balance+v_delta<0 THEN RAISE EXCEPTION 'balance_underflow' USING ERRCODE='P0011'; END IF;
 v_allow_negative := coalesce((SELECT allow_negative_stock FROM public.business_config LIMIT 1),true);

 -- Les restitutions précèdent les déductions ; seules les différences de quantité bougent.
 FOR v_stock IN
  WITH changes AS (
   SELECT product_id,-quantity AS qty FROM public.order_items WHERE order_id=p_order_id
   UNION ALL SELECT product_id,quantity FROM jsonb_to_recordset(v_lines) AS x(product_id uuid,quantity numeric)
  ) SELECT product_id,sum(qty) AS qty FROM changes GROUP BY product_id HAVING sum(qty)<>0 ORDER BY sum(qty),product_id
 LOOP
  SELECT * INTO v_product FROM public.products WHERE id=v_stock.product_id FOR UPDATE;
  IF v_product.track_inventory THEN
   IF v_stock.qty<0 THEN
    PERFORM public._restore_sale_stock_v1(v_product.id,-v_stock.qty,p_order_id,v_actor,'B2B order edit');
   ELSE
    PERFORM public._record_sale_stock_v1(v_product.id,v_stock.qty,p_order_id,v_actor,'B2B order edit',p_allow_negative:=v_allow_negative);
   END IF;
  ELSIF v_product.deduct_stock THEN
   FOR v_cons IN SELECT * FROM public._resolve_order_recipe_restoration_v1(p_order_id,v_product.id,abs(v_stock.qty)) LOOP
    IF v_stock.qty<0 THEN
     PERFORM public._restore_sale_stock_v1(v_cons.product_id,v_cons.qty_base,p_order_id,v_actor,'B2B order edit — recipe',p_unit:=v_cons.unit);
    ELSE
     PERFORM public._record_sale_stock_v1(v_cons.product_id,v_cons.qty_base,p_order_id,v_actor,'B2B order edit — recipe',p_unit:=v_cons.unit,p_allow_negative:=v_allow_negative);
    END IF;
   END LOOP;
  END IF;
 END LOOP;
 DELETE FROM public.order_items oi WHERE order_id=p_order_id
  AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(v_lines) AS x(id uuid) WHERE x.id=oi.id);
 FOR v_line IN SELECT * FROM jsonb_to_recordset(v_lines)
  AS x(id uuid,product_id uuid,quantity numeric,unit_price numeric,line_total numeric,name_snapshot text) LOOP
  UPDATE public.order_items SET quantity=v_line.quantity,line_total=v_line.line_total WHERE id=v_line.id AND order_id=p_order_id;
  IF NOT FOUND THEN
   INSERT INTO public.order_items(id,order_id,product_id,name_snapshot,quantity,unit_price,line_total)
    VALUES(v_line.id,p_order_id,v_line.product_id,v_line.name_snapshot,v_line.quantity,v_line.unit_price,v_line.line_total);
  END IF;
 END LOOP;
 IF v_delta<>0 THEN
  v_ar := public.resolve_mapping_account('B2B_AR');
  v_revenue := public.resolve_mapping_account('SALE_B2B_REVENUE');
  INSERT INTO public.journal_entries(entry_number,entry_date,description,reference_type,reference_id,
   status,total_debit,total_credit,created_by,metadata)
  VALUES(public.next_journal_entry_number(current_date),current_date,'B2B order edit '||v_order.order_number,
   'b2b_order',p_order_id,'posted',abs(v_delta),abs(v_delta),v_actor,
   jsonb_build_object('movement_type','b2b_edit:'||p_idempotency_key::text)) RETURNING id INTO v_je;
  INSERT INTO public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description) VALUES
   (v_je,v_ar,greatest(v_delta,0),greatest(-v_delta,0),'B2B edit — AR'),
   (v_je,v_revenue,greatest(-v_delta,0),greatest(v_delta,0),'B2B edit — revenue');
  UPDATE public.customers SET b2b_current_balance=v_balance+v_delta,updated_at=now() WHERE id=v_customer;
 END IF;
 UPDATE public.orders SET subtotal=v_total,total=v_total,notes=nullif(trim(p_notes),''),updated_at=now()
  WHERE id=p_order_id RETURNING * INTO v_order;
 SELECT jsonb_agg(to_jsonb(oi) ORDER BY oi.id) INTO v_after FROM public.order_items oi WHERE order_id=p_order_id;
 v_result := jsonb_build_object('order_id',p_order_id,'total',v_total,'updated_at',v_order.updated_at,
  'idempotency_key',p_idempotency_key,'idempotent_replay',false);
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,'b2b.order.edited','orders',p_order_id,
  jsonb_build_object('idempotency_key',p_idempotency_key,'je_id',v_je,'total_delta',v_delta),
  jsonb_build_object('before',jsonb_build_object('items',v_before,'notes',v_old_notes),
   'after',jsonb_build_object('items',v_after,'notes',nullif(trim(p_notes),''))));
 INSERT INTO public.b2b_order_edit_keys(idempotency_key,order_id,actor_id,request,result)
  VALUES(p_idempotency_key,p_order_id,v_actor,v_request,v_result);
 RETURN v_result;
EXCEPTION WHEN unique_violation THEN
 SELECT * INTO v_existing FROM public.b2b_order_edit_keys WHERE idempotency_key=p_idempotency_key;
 IF NOT FOUND OR v_existing.actor_id<>v_actor OR v_existing.request<>v_request THEN RAISE; END IF;
 RETURN v_existing.result || jsonb_build_object('idempotent_replay',true);
WHEN OTHERS THEN
 -- Ne pas exposer le stock confidentiel par un message de rejet.
 IF SQLSTATE='P0002' AND SQLERRM ~* '(insufficient.*stock|have )' THEN
  RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
 END IF;
 RAISE;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_b2b_order_v1(uuid,jsonb,text,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_b2b_order_v1(uuid,jsonb,text,timestamptz,uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
