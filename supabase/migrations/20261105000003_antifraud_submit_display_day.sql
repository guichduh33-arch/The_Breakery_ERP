-- Même circuit de déclaration/approbation que le waste vitrine existant.
CREATE FUNCTION stock_private.submit_day_waste_v1(p_product_id uuid,p_quantity numeric,p_reason text,p_key uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=public.get_current_profile_id(); v_expected numeric; v_id uuid; v_movement uuid;
BEGIN
 SELECT quantity INTO v_expected FROM public.display_stock WHERE product_id=p_product_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'display_stock_not_found' USING ERRCODE='P0002'; END IF;
 IF v_expected<p_quantity THEN RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.stock_declarations(operation,product_id,quantity,baseline_quantity,reason,declared_by,
  idempotency_key,display_withdrawal_applied)
 VALUES('display_waste',p_product_id,p_quantity,v_expected,p_reason,v_actor,p_key,true) RETURNING id INTO v_id;
 INSERT INTO public.display_movements(product_id,movement_type,quantity,reason,created_by,idempotency_key,
  reference_type,reference_id)
 VALUES(p_product_id,'waste',-p_quantity,p_reason,v_actor,v_id,'stock_declaration',v_id) RETURNING id INTO v_movement;
 UPDATE public.display_stock SET quantity=quantity-p_quantity,updated_at=now() WHERE product_id=p_product_id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload) VALUES
 (v_actor,'display.waste','display_movement',v_movement,
  jsonb_build_object('declaration_id',v_id,'declared_by',v_actor),
  jsonb_build_object('product_id',p_product_id,'quantity',-p_quantity,'reason',p_reason)),
 (v_actor,'stock.declaration_submitted','stock_declarations',v_id,
  jsonb_build_object('operation','display_waste'),
  jsonb_build_object('product_id',p_product_id,'quantity',p_quantity,'reason',p_reason));
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION stock_private.submit_day_waste_v1(uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;

-- Cette référence est un constat informatif ; elle ne modifie aucun stock.
CREATE FUNCTION stock_private.display_day_reference_basis_v1(p_sku text,p_category_slug text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN p_sku IN('IND-003','IND-007','IND-013','IND-005') THEN 'display'
 WHEN p_sku IN('CLV-007','CLV-009','CLV-001','CLV-002','CLB-005') OR p_category_slug='sourdough-breads'
 THEN 'fresh_production' ELSE 'general' END
$$;
REVOKE ALL ON FUNCTION stock_private.display_day_reference_basis_v1(text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION stock_private.display_day_reference_v1(p_product_id uuid,p_day date,p_current_waste_id uuid DEFAULT NULL)
RETURNS TABLE(reference_basis text,expected_qty numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_product public.products%ROWTYPE; v_category text; v_pending numeric; v_produced numeric; v_outgoing numeric;
BEGIN
 SELECT * INTO STRICT v_product FROM public.products WHERE id=p_product_id;
 SELECT slug INTO v_category FROM public.categories WHERE id=v_product.category_id;
 reference_basis:=stock_private.display_day_reference_basis_v1(v_product.sku,v_category);
 IF reference_basis='display' THEN
  SELECT coalesce(quantity,0) INTO expected_qty FROM public.display_stock WHERE product_id=p_product_id;
  expected_qty:=coalesce(expected_qty,0);
 ELSIF reference_basis='fresh_production' THEN
  -- Le rendement réel est la quantité bonne effectivement entrée en stock.
  SELECT coalesce(sum(coalesce(actual_yield_qty,quantity_produced)),0) INTO v_produced
  FROM public.production_records WHERE product_id=p_product_id AND production_date::date=p_day AND reverted_at IS NULL;
  -- Les mouvements production_in sont déjà portés par les productions non annulées.
  -- Une entrée d'achat/freezer n'est pas une production fraîche du jour.
  SELECT coalesce(sum(CASE WHEN quantity<0 OR movement_type::text IN('sale_void','production_out')
   THEN quantity ELSE 0 END),0) INTO v_outgoing FROM public.stock_movements
  WHERE product_id=p_product_id AND created_at::date=p_day AND movement_type::text<>'production_in';
  SELECT coalesce(sum(d.quantity),0) INTO v_pending FROM public.stock_declarations d
  WHERE d.product_id=p_product_id AND d.status='pending' AND d.operation IN('waste','display_waste')
   AND (d.declared_at::date=p_day OR d.id=p_current_waste_id OR EXISTS(
    SELECT 1 FROM public.display_day_closing_items i JOIN public.display_day_closings h ON h.id=i.closing_id
    WHERE i.waste_declaration_id=d.id AND h.business_day=p_day));
  expected_qty:=v_produced+v_outgoing-v_pending;
 ELSE
  -- Le stock global inclut encore le waste physique en attente de l'Owner.
  SELECT coalesce(sum(quantity),0) INTO v_pending FROM public.stock_declarations
  WHERE product_id=p_product_id AND status='pending' AND operation IN('waste','display_waste');
  expected_qty:=v_product.current_stock-v_pending;
 END IF;
 RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION stock_private.display_day_reference_v1(uuid,date,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.submit_display_day_closing_v1(p_business_day date,p_items jsonb,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=public.get_current_profile_id(); v_saved public.display_day_closings%ROWTYPE;
 v_request jsonb; v_items jsonb; v_line record; v_id uuid; v_expected numeric; v_declaration uuid; v_basis text;
BEGIN
 IF v_actor IS NULL OR NOT public.request_has_active_pin_session_v1()
  OR NOT public.has_permission(auth.uid(),'display.count') THEN
  RAISE EXCEPTION 'permission_denied: display.count' USING ERRCODE='P0003'; END IF;
 IF p_idempotency_key IS NULL OR p_business_day IS NULL THEN
  RAISE EXCEPTION 'closing_identity_required' USING ERRCODE='22023'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'display_items_required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x)<>'object') THEN
  RAISE EXCEPTION 'invalid_display_item' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items)
  x(product_id uuid,remaining_qty numeric,waste_qty numeric,waste_reason text)
  WHERE product_id IS NULL OR remaining_qty IS NULL OR waste_qty IS NULL
   OR remaining_qty::text IN('NaN','Infinity','-Infinity') OR waste_qty::text IN('NaN','Infinity','-Infinity')
   OR remaining_qty<0 OR waste_qty<0 OR remaining_qty>9999999.999 OR waste_qty>9999999.999
   OR remaining_qty<>round(remaining_qty,3) OR waste_qty<>round(waste_qty,3)
   OR (waste_qty>0 AND length(btrim(coalesce(waste_reason,'')))<3)
   OR length(coalesce(waste_reason,''))>2000)
 OR EXISTS(SELECT product_id FROM jsonb_to_recordset(p_items) x(product_id uuid) GROUP BY product_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'invalid_display_quantity_or_reason' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'remaining_qty',remaining_qty,
  'waste_qty',waste_qty,'waste_reason',CASE WHEN waste_qty>0 THEN btrim(waste_reason) END) ORDER BY product_id)
 INTO v_items FROM jsonb_to_recordset(p_items)
  x(product_id uuid,remaining_qty numeric,waste_qty numeric,waste_reason text);
 v_request:=jsonb_build_object('business_day',p_business_day,'items',v_items);
 PERFORM pg_advisory_xact_lock(hashtextextended('display-day-key:'||p_idempotency_key::text,0));
 SELECT * INTO v_saved FROM public.display_day_closings WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_saved.recorded_by<>v_actor OR v_saved.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('closing_id',v_saved.id,'business_day',v_saved.business_day,
   'revision',v_saved.revision,'idempotent_replay',true);
 END IF;
 IF p_business_day NOT BETWEEN current_date-1 AND current_date THEN
  RAISE EXCEPTION 'invalid_business_day' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('display-day:'||p_business_day::text,0));
 IF EXISTS(SELECT 1 FROM public.display_day_closings WHERE business_day=p_business_day) THEN
  RAISE EXCEPTION 'display_day_already_submitted' USING ERRCODE='23505'; END IF;
 -- Verrouillage déterministe de tout le lot, avant le premier retrait vitrine.
 PERFORM p.id FROM public.products p JOIN jsonb_to_recordset(v_items) x(product_id uuid) ON x.product_id=p.id
  WHERE p.is_display_item AND p.deleted_at IS NULL ORDER BY p.id FOR UPDATE OF p;
 IF (SELECT count(*) FROM public.products p JOIN jsonb_to_recordset(v_items) x(product_id uuid) ON x.product_id=p.id
  WHERE p.is_display_item AND p.deleted_at IS NULL)<>jsonb_array_length(v_items) THEN
  RAISE EXCEPTION 'not_a_display_item' USING ERRCODE='P0002'; END IF;
 INSERT INTO public.display_day_closings(business_day,revision,recorded_by,idempotency_key,request)
 VALUES(p_business_day,1,v_actor,p_idempotency_key,v_request) RETURNING id INTO v_id;
 FOR v_line IN SELECT * FROM jsonb_to_recordset(v_items)
  x(product_id uuid,remaining_qty numeric,waste_qty numeric,waste_reason text) ORDER BY product_id LOOP
  v_declaration:=NULL;
  IF v_line.waste_qty>0 THEN
   v_declaration:=stock_private.submit_day_waste_v1(v_line.product_id,v_line.waste_qty,v_line.waste_reason,
    md5('display-day:'||p_idempotency_key::text||':'||v_line.product_id::text)::uuid);
  END IF;
  SELECT r.reference_basis,r.expected_qty INTO v_basis,v_expected
  FROM stock_private.display_day_reference_v1(v_line.product_id,p_business_day,v_declaration) r;
  INSERT INTO public.display_day_closing_items(closing_id,product_id,remaining_qty,waste_qty,waste_reason,
   reference_basis,expected_qty,waste_declaration_id)
  VALUES(v_id,v_line.product_id,v_line.remaining_qty,v_line.waste_qty,v_line.waste_reason,
   v_basis,v_expected,v_declaration);
 END LOOP;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,'display.day_count_submitted','display_day_closings',v_id,
  jsonb_build_object('business_day',p_business_day,'revision',1),jsonb_build_object('items',v_items));
 RETURN jsonb_build_object('closing_id',v_id,'business_day',p_business_day,'revision',1,'idempotent_replay',false);
END $$;
REVOKE ALL ON FUNCTION public.submit_display_day_closing_v1(date,jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_display_day_closing_v1(date,jsonb,uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
