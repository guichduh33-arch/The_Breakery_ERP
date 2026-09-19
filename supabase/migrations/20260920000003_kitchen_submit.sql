-- Contrat cuisine : unités résolues serveur, date métier et replay propriétaire.
CREATE FUNCTION public.record_kitchen_production_v1(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_profile uuid := _kitchen_profile_v1(); v_section uuid; v_key uuid;
  v_existing kitchen_submissions%ROWTYPE; v_item jsonb; v_product products%ROWTYPE;
  v_factor numeric; v_qty numeric; v_waste numeric; v_items jsonb := '[]';
  v_result jsonb; v_response jsonb; v_seen uuid[] := '{}'; v_unit text;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object'
    OR (p_request - ARRAY['idempotency_key','section_id','day','items']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid_kitchen_request';
  END IF;
  v_key := (p_request->>'idempotency_key')::uuid;
  v_section := (p_request->>'section_id')::uuid;
  IF v_key IS NULL OR v_section IS NULL THEN RAISE EXCEPTION 'invalid_kitchen_request'; END IF;
  PERFORM _kitchen_assert_section_v1(v_section);
  -- Sérialise les retries avant toute validation susceptible de changer (jour, recette, stock).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key::text, 731));
  SELECT * INTO v_existing FROM kitchen_submissions WHERE id = v_key;
  IF FOUND THEN
    IF v_existing.user_profile_id <> v_profile OR v_existing.section_id <> v_section THEN
      RAISE EXCEPTION 'kitchen_forbidden' USING ERRCODE = 'P0003';
    END IF;
    IF v_existing.request <> p_request THEN RAISE EXCEPTION 'idempotency_payload_mismatch'; END IF;
    RETURN v_existing.response || jsonb_build_object('idempotent_replay', true);
  END IF;
  IF (p_request->>'day')::date IS DISTINCT FROM CURRENT_DATE THEN RAISE EXCEPTION 'kitchen_today_only'; END IF;
  IF jsonb_typeof(p_request->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_kitchen_items'; END IF;
  IF jsonb_array_length(p_request->'items') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_kitchen_items'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_request->'items') LOOP
    IF jsonb_typeof(v_item) <> 'object' OR
      (v_item - ARRAY['product_id','unit','quantity_produced','quantity_waste','waste_reason','note']) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'invalid_kitchen_item';
    END IF;
    SELECT p.* INTO v_product FROM products p JOIN product_sections ps ON ps.product_id = p.id
      WHERE p.id = (v_item->>'product_id')::uuid AND ps.section_id = v_section
      AND p.is_active AND p.deleted_at IS NULL AND p.deduct_stock AND p.product_type IN ('finished','semi_finished');
    IF NOT FOUND THEN RAISE EXCEPTION 'kitchen_product_forbidden' USING ERRCODE = 'P0003'; END IF;
    IF v_product.id = ANY(v_seen) THEN RAISE EXCEPTION 'duplicate_kitchen_product'; END IF;
    v_seen := array_append(v_seen, v_product.id);
    v_unit := v_item->>'unit';
    v_factor := NULL;
    IF v_unit = v_product.unit THEN v_factor := 1;
    ELSE SELECT factor_to_base INTO v_factor FROM product_unit_alternatives
      WHERE product_id = v_product.id AND code = v_unit AND deleted_at IS NULL;
    END IF;
    IF v_factor IS NULL OR v_factor <= 0 THEN RAISE EXCEPTION 'invalid_kitchen_unit'; END IF;
    v_qty := (v_item->>'quantity_produced')::numeric;
    v_waste := (v_item->>'quantity_waste')::numeric;
    IF v_qty IS NULL OR v_waste IS NULL OR v_qty::text IN ('NaN','Infinity','-Infinity')
      OR v_waste::text IN ('NaN','Infinity','-Infinity') OR v_qty <= 0 OR v_waste < 0
      OR v_qty * v_factor > 9999999 OR v_waste * v_factor > 9999999 THEN
      RAISE EXCEPTION 'invalid_kitchen_quantity';
    END IF;
    IF length(coalesce(v_item->>'note','')) > 1000 THEN RAISE EXCEPTION 'kitchen_note_too_long'; END IF;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', v_product.id,
      'quantity_produced', v_qty * v_factor, 'quantity_waste', v_waste * v_factor,
      'waste_reason', nullif(v_item->>'waste_reason','')));
  END LOOP;
  -- Le core historique réutilise cette même clé ; un ancien lot étranger ne peut pas être rejoué.
  IF EXISTS (SELECT 1 FROM production_batches WHERE idempotency_key = v_key) THEN
    RAISE EXCEPTION 'idempotency_payload_mismatch';
  END IF;
  INSERT INTO kitchen_submissions(id,user_profile_id,section_id,request) VALUES(v_key,v_profile,v_section,p_request);
  v_result := record_batch_production_v8(jsonb_build_object('section_id',v_section,'idempotency_key',v_key),v_items);
  UPDATE production_records pr SET notes = nullif(i->>'note','')
    FROM jsonb_array_elements(p_request->'items') i
    WHERE pr.batch_id = (v_result->>'batch_id')::uuid AND pr.product_id = (i->>'product_id')::uuid;
  v_response := jsonb_build_object('batch_id',v_result->'batch_id','batch_number',v_result->'batch_number','idempotent_replay',false);
  UPDATE kitchen_submissions SET response = v_response WHERE id = v_key;
  RETURN v_response;
END $$;

-- Permet de résoudre une réponse perdue sans créer une production après minuit.
CREATE FUNCTION public.get_kitchen_submission_v1(p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile uuid := _kitchen_profile_v1(); v_row kitchen_submissions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM kitchen_submissions WHERE id = p_idempotency_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_row.user_profile_id <> v_profile THEN RAISE EXCEPTION 'kitchen_forbidden' USING ERRCODE = 'P0003'; END IF;
  PERFORM _kitchen_assert_section_v1(v_row.section_id);
  RETURN v_row.response;
END $$;
REVOKE ALL ON FUNCTION public.record_kitchen_production_v1(jsonb), public.get_kitchen_submission_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_kitchen_production_v1(jsonb), public.get_kitchen_submission_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
