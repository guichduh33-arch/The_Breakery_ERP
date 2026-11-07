CREATE FUNCTION public.get_display_day_closing_v1(p_business_day date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_owner boolean:=public.is_business_owner_v1(); v_header public.display_day_closings%ROWTYPE;
 v_items jsonb; v_history jsonb;
BEGIN
 IF public.get_current_profile_id() IS NULL OR NOT public.request_has_active_pin_session_v1()
  OR NOT (v_owner OR public.has_permission(auth.uid(),'display.count')) THEN
  RAISE EXCEPTION 'permission_denied: display.count' USING ERRCODE='P0003'; END IF;
 IF p_business_day IS NULL THEN RAISE EXCEPTION 'business_day_required' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_header FROM public.display_day_closings WHERE business_day=p_business_day
  ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT jsonb_agg(jsonb_build_object('product_id',i.product_id,'product_name',p.name,'unit',p.unit,
  'remaining_qty',i.remaining_qty,'waste_qty',i.waste_qty,'waste_reason',i.waste_reason,
  'waste_declaration_id',i.waste_declaration_id,'waste_status',d.status,
  'waste_reviewed_at',d.reviewed_at,'waste_rejection_reason',d.rejection_reason)
  ||CASE WHEN v_owner THEN jsonb_build_object('reference_basis',i.reference_basis,'expected_qty',i.expected_qty,
    'variance',i.remaining_qty-i.expected_qty) ELSE '{}'::jsonb END ORDER BY p.name,p.id)
 INTO v_items FROM public.display_day_closing_items i JOIN public.products p ON p.id=i.product_id
 LEFT JOIN public.stock_declarations d ON d.id=i.waste_declaration_id WHERE i.closing_id=v_header.id;
 SELECT jsonb_agg(jsonb_build_object('closing_id',h.id,'revision',h.revision,
  'recorded_by',h.recorded_by,'recorded_at',h.recorded_at,'correction_reason',h.correction_reason)
  ORDER BY h.revision) INTO v_history FROM public.display_day_closings h WHERE h.business_day=p_business_day;
 RETURN jsonb_build_object('closing_id',v_header.id,'business_day',v_header.business_day,
  'revision',v_header.revision,'recorded_by',v_header.recorded_by,'recorded_at',v_header.recorded_at,
  'is_owner',v_owner,'items',coalesce(v_items,'[]'::jsonb),'history',v_history);
END $$;
REVOKE ALL ON FUNCTION public.get_display_day_closing_v1(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_display_day_closing_v1(date) TO authenticated,service_role;

CREATE FUNCTION public.correct_display_day_count_v1(p_closing_id uuid,p_counts jsonb,p_reason text,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_actor uuid:=public.get_current_profile_id(); v_source public.display_day_closings%ROWTYPE;
 v_saved public.display_day_closings%ROWTYPE; v_request jsonb; v_counts jsonb; v_id uuid;
BEGIN
 IF v_actor IS NULL OR NOT public.request_has_active_pin_session_v1()
  OR NOT public.has_permission(auth.uid(),'display.count') THEN
  RAISE EXCEPTION 'permission_denied: display.count' USING ERRCODE='P0003'; END IF;
 IF p_idempotency_key IS NULL OR p_closing_id IS NULL OR length(btrim(coalesce(p_reason,'')))<3
  OR length(coalesce(p_reason,''))>2000 THEN
  RAISE EXCEPTION 'correction_identity_and_reason_required' USING ERRCODE='22023'; END IF;
 IF p_counts IS NULL OR jsonb_typeof(p_counts)<>'array' OR jsonb_array_length(p_counts) NOT BETWEEN 1 AND 500 THEN
  RAISE EXCEPTION 'display_counts_required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_counts) x WHERE jsonb_typeof(x)<>'object'
  OR x ? 'waste_qty' OR x ? 'waste_reason') THEN
  RAISE EXCEPTION 'correction_cannot_change_waste' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_counts) x(product_id uuid,remaining_qty numeric)
  WHERE product_id IS NULL OR remaining_qty IS NULL OR remaining_qty<0 OR remaining_qty>9999999.999
   OR remaining_qty::text IN('NaN','Infinity','-Infinity') OR remaining_qty<>round(remaining_qty,3))
 OR EXISTS(SELECT product_id FROM jsonb_to_recordset(p_counts) x(product_id uuid) GROUP BY product_id HAVING count(*)>1) THEN
  RAISE EXCEPTION 'invalid_display_count' USING ERRCODE='22023'; END IF;
 SELECT jsonb_agg(jsonb_build_object('product_id',product_id,'remaining_qty',remaining_qty) ORDER BY product_id)
 INTO v_counts FROM jsonb_to_recordset(p_counts) x(product_id uuid,remaining_qty numeric);
 v_request:=jsonb_build_object('corrects_id',p_closing_id,'counts',v_counts,'reason',btrim(p_reason));
 PERFORM pg_advisory_xact_lock(hashtextextended('display-day-key:'||p_idempotency_key::text,0));
 SELECT * INTO v_saved FROM public.display_day_closings WHERE idempotency_key=p_idempotency_key;
 IF FOUND THEN
  IF v_saved.recorded_by<>v_actor OR v_saved.request<>v_request THEN
   RAISE EXCEPTION 'idempotency_conflict' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('closing_id',v_saved.id,'business_day',v_saved.business_day,
   'revision',v_saved.revision,'idempotent_replay',true);
 END IF;
 SELECT * INTO v_source FROM public.display_day_closings WHERE id=p_closing_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'display_count_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT public.is_business_owner_v1() AND v_source.recorded_by<>v_actor THEN
  RAISE EXCEPTION 'count_author_required' USING ERRCODE='P0003'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('display-day:'||v_source.business_day::text,0));
 IF EXISTS(SELECT 1 FROM public.display_day_closings WHERE business_day=v_source.business_day
  AND revision>v_source.revision) THEN RAISE EXCEPTION 'display_count_changed_reload' USING ERRCODE='40001'; END IF;
 IF (SELECT count(*) FROM public.display_day_closing_items WHERE closing_id=p_closing_id)<>jsonb_array_length(v_counts)
 OR EXISTS(SELECT 1 FROM jsonb_to_recordset(v_counts) x(product_id uuid) WHERE NOT EXISTS(
  SELECT 1 FROM public.display_day_closing_items i WHERE i.closing_id=p_closing_id AND i.product_id=x.product_id)) THEN
  RAISE EXCEPTION 'correction_products_must_match' USING ERRCODE='22023'; END IF;
 INSERT INTO public.display_day_closings(business_day,revision,supersedes_id,recorded_by,
  correction_reason,idempotency_key,request)
 VALUES(v_source.business_day,v_source.revision+1,p_closing_id,v_actor,btrim(p_reason),p_idempotency_key,v_request)
 RETURNING id INTO v_id;
 INSERT INTO public.display_day_closing_items(closing_id,product_id,remaining_qty,waste_qty,waste_reason,reference_basis,expected_qty,waste_declaration_id)
 SELECT v_id,i.product_id,x.remaining_qty,i.waste_qty,i.waste_reason,i.reference_basis,i.expected_qty,i.waste_declaration_id
 FROM public.display_day_closing_items i JOIN jsonb_to_recordset(v_counts) x(product_id uuid,remaining_qty numeric)
 ON x.product_id=i.product_id WHERE i.closing_id=p_closing_id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,'display.day_count_corrected','display_day_closings',v_id,
  jsonb_build_object('business_day',v_source.business_day,'supersedes_id',p_closing_id,'reason',btrim(p_reason)),
  jsonb_build_object('counts',v_counts));
 RETURN jsonb_build_object('closing_id',v_id,'business_day',v_source.business_day,
  'revision',v_source.revision+1,'idempotent_replay',false);
END $$;
REVOKE ALL ON FUNCTION public.correct_display_day_count_v1(uuid,jsonb,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.correct_display_day_count_v1(uuid,jsonb,text,uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
