-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.record_kitchen_production_v2(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_result := record_batch_production_v10(jsonb_build_object('section_id',v_section,'idempotency_key',v_key),v_items);
  UPDATE production_records pr SET notes = nullif(i->>'note','')
    FROM jsonb_array_elements(p_request->'items') i
    WHERE pr.batch_id = (v_result->>'batch_id')::uuid AND pr.product_id = (i->>'product_id')::uuid;
  v_response := jsonb_build_object('batch_id',v_result->'batch_id','batch_number',v_result->'batch_number','idempotent_replay',false);
  UPDATE kitchen_submissions SET response = v_response WHERE id = v_key;
  RETURN v_response;
END $function$
;
REVOKE ALL ON FUNCTION stock_private.record_kitchen_production_v2(p_request jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_kitchen_production_v3(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.record_kitchen_production_v2(p_request));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.record_kitchen_production_v2(p_request jsonb);
REVOKE ALL ON FUNCTION public.record_kitchen_production_v3(p_request jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_kitchen_production_v3(p_request jsonb) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.record_production_v7(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text DEFAULT NULL::text, p_quantity_waste numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_recurse_subrecipes boolean DEFAULT true, p_expected_yield_qty numeric DEFAULT NULL::numeric, p_actual_yield_qty numeric DEFAULT NULL::numeric, p_yield_variance_reason text DEFAULT NULL::text, p_force_negative boolean DEFAULT false, p_waste_reason waste_reason DEFAULT NULL::waste_reason)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE   v_uid               UUID := auth.uid();   v_profile           UUID;
  v_product_unit      TEXT;   v_product_cost      DECIMAL(14,2);   v_product_shelf     INT;
  v_production_id     UUID;   v_production_number TEXT;   v_lot_id            UUID;
  v_lot_idem_key      UUID;   v_total_factor      DECIMAL(14,4);   v_recipe_count      INT;
  v_missing           JSONB := '[]'::JSONB;   v_movements_count   INT := 0;   v_je_count          INT;
  v_movement_ids      UUID[] := ARRAY[]::UUID[];   v_movement_id       UUID;   v_in_movement_id    UUID;
  v_in_result         JSONB;   v_out_result        JSONB;   v_rec               RECORD;
  v_breakdown         JSONB := '[]'::JSONB;   v_recipe_version_id UUID;   v_max_depth_const   CONSTANT INT := 5;
  v_max_depth_reached INT := 0;   v_truncated         INT := 0;   v_expected_yield    DECIMAL(10,3);
  v_actual_yield      DECIMAL(10,3);   v_yield_reason      TEXT;   v_existing_row      production_records%ROWTYPE;
  v_total_consumed    DECIMAL(14,2) := 0;   v_allow_negative    BOOLEAN;   v_deduct_stock      BOOLEAN;
  v_waste_target      DECIMAL(14,2) := 0;   v_unit_cost_in      DECIMAL(14,2);   v_waste_cost        DECIMAL(14,2) := 0;
  v_waste_je_id       UUID;   v_waste_entry_no    TEXT;   v_waste_je_date     DATE;
BEGIN   IF NOT has_permission(v_uid, 'inventory.production.create') AND NOT _kitchen_context_v1(p_section_id, p_product_id) THEN     RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;   v_allow_negative := COALESCE(p_force_negative, false);   IF v_allow_negative AND NOT has_permission(v_uid, 'inventory.production.force_negative') THEN
    RAISE EXCEPTION 'force_negative_forbidden' USING ERRCODE='P0003',       HINT = 'inventory.production.force_negative is required to produce below stock';   END IF;
  IF p_section_id IS NULL THEN     RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001',       HINT = 'production movements require a section (chk_stock_movements_section_required)';
  END IF;   IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN     RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
  END IF;   IF p_quantity_waste IS NULL OR p_quantity_waste < 0 THEN     RAISE EXCEPTION 'waste_must_be_non_negative' USING ERRCODE='P0001';
  END IF;   IF p_quantity_waste > 0 AND p_waste_reason IS NULL THEN     RAISE EXCEPTION 'waste_reason_required' USING ERRCODE='P0001',
      HINT = 'ADR-008 D3: quantity_waste > 0 requires a waste_reason';   END IF;   IF p_expected_yield_qty IS NOT NULL AND p_expected_yield_qty <= 0 THEN
    RAISE EXCEPTION 'expected_yield_must_be_positive' USING ERRCODE='P0001';   END IF;   IF p_actual_yield_qty IS NOT NULL AND p_actual_yield_qty < 0 THEN
    RAISE EXCEPTION 'actual_yield_must_be_non_negative' USING ERRCODE='P0001';   END IF;   IF p_yield_variance_reason IS NOT NULL
     AND length(trim(p_yield_variance_reason)) < 5 THEN     RAISE EXCEPTION 'variance_reason_too_short' USING ERRCODE='P0001';   END IF;
  v_expected_yield := COALESCE(p_expected_yield_qty, p_quantity_produced);   v_actual_yield   := COALESCE(p_actual_yield_qty,   p_quantity_produced);   v_yield_reason   := p_yield_variance_reason;
  IF p_idempotency_key IS NOT NULL THEN     SELECT * INTO v_existing_row FROM production_records       WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_row.id IS NOT NULL THEN       SELECT COUNT(*) INTO v_movements_count         FROM stock_movements
        WHERE reference_type = 'production' AND reference_id = v_existing_row.id;       RETURN jsonb_build_object(         'production_id',         v_existing_row.id,
        'production_number',     v_existing_row.production_number,         'movements_count',       v_movements_count,         'idempotent_replay',     true,
        'expected_yield_qty',    v_existing_row.expected_yield_qty,         'actual_yield_qty',      v_existing_row.actual_yield_qty,         'yield_variance_pct',    v_existing_row.yield_variance_pct,
        'yield_variance_reason', v_existing_row.yield_variance_reason,         'waste_reason',          v_existing_row.waste_reason       );
    END IF;   END IF;   SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;   IF v_profile IS NULL THEN     RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;   SELECT unit, cost_price, default_shelf_life_hours, COALESCE(deduct_stock, true)     INTO v_product_unit, v_product_cost, v_product_shelf, v_deduct_stock
    FROM products     WHERE id = p_product_id AND deleted_at IS NULL;   IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';   END IF;   IF NOT v_deduct_stock THEN
    RAISE EXCEPTION 'production_requires_deduct_stock' USING ERRCODE='P0001',       HINT = 'ADR-008 D6: a product flagged as not tracking stock cannot be produced';   END IF;
  IF p_section_id IS NOT NULL      AND NOT EXISTS (SELECT 1 FROM sections WHERE id = p_section_id AND deleted_at IS NULL) THEN     RAISE EXCEPTION 'section_not_found' USING ERRCODE='P0002';
  END IF;   SELECT COUNT(*) INTO v_recipe_count     FROM recipes r
    WHERE r.product_id = p_product_id       AND r.is_active = TRUE       AND r.deleted_at IS NULL;
  IF v_recipe_count = 0 THEN     RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002';   END IF;
  v_total_factor := p_quantity_produced + p_quantity_waste;   DROP TABLE IF EXISTS pg_temp._bom_flatten;   DROP TABLE IF EXISTS pg_temp._leaf_consumption;
  CREATE TEMP TABLE _bom_flatten (     material_id    UUID,     material_name  TEXT,
    material_unit  TEXT,     material_cost  DECIMAL(14,2),     material_stock DECIMAL(14,3),
    recipe_unit    TEXT,     qty_in_recipe_unit DECIMAL(20,6),     depth          INT,
    sub_path       UUID[],     is_intermediate BOOLEAN,     is_stocked     BOOLEAN
  ) ON COMMIT DROP;   WITH RECURSIVE flatten AS (     SELECT
      r.material_id,       m.name AS material_name,       m.unit AS material_unit,
      m.cost_price AS material_cost,       m.current_stock AS material_stock,       r.unit AS recipe_unit,
      (r.quantity * v_total_factor)::DECIMAL(20,6) AS qty_in_recipe_unit,       1 AS depth,       ARRAY[p_product_id]::UUID[] AS sub_path,
      EXISTS (         SELECT 1 FROM recipes r2 WHERE r2.product_id = r.material_id           AND r2.is_active = TRUE AND r2.deleted_at IS NULL
      ) AS is_intermediate,       COALESCE(m.track_inventory, TRUE) AS is_stocked     FROM recipes r
    JOIN products m ON m.id = r.material_id     WHERE r.product_id = p_product_id       AND r.is_active = TRUE
      AND r.deleted_at IS NULL     UNION ALL     SELECT
      r.material_id,       m.name,       m.unit,
      m.cost_price,       m.current_stock,       r.unit,
      (convert_quantity(f.qty_in_recipe_unit, f.recipe_unit, f.material_unit) * r.quantity)::DECIMAL(20,6),       f.depth + 1,       f.sub_path || f.material_id,
      EXISTS (         SELECT 1 FROM recipes r2 WHERE r2.product_id = r.material_id           AND r2.is_active = TRUE AND r2.deleted_at IS NULL
      ),       COALESCE(m.track_inventory, TRUE)     FROM flatten f
    JOIN recipes r ON r.product_id = f.material_id     JOIN products m ON m.id = r.material_id     WHERE p_recurse_subrecipes = TRUE
      AND f.is_intermediate = TRUE       AND f.is_stocked = FALSE       AND r.is_active = TRUE
      AND r.deleted_at IS NULL       AND f.depth < v_max_depth_const       AND NOT (r.material_id = ANY(f.sub_path))
  )   INSERT INTO _bom_flatten   SELECT material_id, material_name, material_unit, material_cost, material_stock,
         recipe_unit, qty_in_recipe_unit, depth, sub_path, is_intermediate, is_stocked     FROM flatten;   SELECT COALESCE(MAX(depth), 0) INTO v_max_depth_reached FROM _bom_flatten;
  IF p_recurse_subrecipes THEN     SELECT COUNT(*) INTO v_truncated       FROM _bom_flatten
     WHERE depth = v_max_depth_const        AND is_intermediate = TRUE        AND is_stocked = FALSE;
    IF v_truncated > 0 THEN       RAISE EXCEPTION 'recipe_depth_exceeded' USING ERRCODE='P0001',         DETAIL = format('%s unexpanded intermediate(s) remain at depth %s for product %s.',
                        v_truncated, v_max_depth_const, p_product_id);     END IF;   END IF;
  SELECT COALESCE(     jsonb_agg(       jsonb_build_object(
        'material_id',    material_id,         'material_name',  material_name,         'leaf',           NOT is_intermediate,
        'consumed',       (NOT is_intermediate) OR is_stocked,         'is_stocked',     is_stocked,         'qty_per_unit',   CASE WHEN p_quantity_produced > 0
                              THEN (CASE WHEN recipe_unit = material_unit                                          THEN qty_in_recipe_unit                                          ELSE convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit)
                                    END / v_total_factor)                               ELSE 0 END,         'total_consumed', CASE WHEN recipe_unit = material_unit
                              THEN qty_in_recipe_unit                               ELSE convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit)                           END,
        'unit',           material_unit,         'depth',          depth,         'sub_path',       to_jsonb(sub_path),
        'is_intermediate', is_intermediate       )       ORDER BY depth, material_name
    ),     '[]'::JSONB   ) INTO v_breakdown FROM _bom_flatten;
  CREATE TEMP TABLE _leaf_consumption (     material_id    UUID PRIMARY KEY,     material_name  TEXT,
    material_unit  TEXT,     material_cost  DECIMAL(14,2),     material_stock DECIMAL(14,3),
    total_consumed DECIMAL(14,3)   ) ON COMMIT DROP;   INSERT INTO _leaf_consumption (material_id, material_name, material_unit, material_cost, material_stock, total_consumed)
  SELECT     f.material_id,     MAX(f.material_name),
    MAX(f.material_unit),     MAX(f.material_cost),     MAX(f.material_stock),
    SUM(       CASE         WHEN f.recipe_unit = f.material_unit THEN f.qty_in_recipe_unit
        ELSE convert_quantity(f.qty_in_recipe_unit, f.recipe_unit, f.material_unit)       END     )::DECIMAL(14,3)
  FROM _bom_flatten f   WHERE     CASE
      WHEN p_recurse_subrecipes THEN (f.is_intermediate = FALSE OR f.is_stocked = TRUE)       ELSE f.depth = 1     END
  GROUP BY f.material_id;   FOR v_rec IN SELECT * FROM _leaf_consumption LOOP     IF v_rec.material_stock < v_rec.total_consumed THEN
      v_missing := v_missing || jsonb_build_object(         'material_id',   v_rec.material_id,         'material_name', v_rec.material_name,
        'required',      v_rec.total_consumed,         'available',     v_rec.material_stock,         'shortfall',     v_rec.total_consumed - v_rec.material_stock,
        'unit',          v_rec.material_unit       );     END IF;
  END LOOP;   IF NOT v_allow_negative AND jsonb_array_length(v_missing) > 0 THEN     RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL = v_missing::text;
  END IF;   IF v_product_shelf IS NOT NULL THEN     v_lot_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()       ELSE md5(p_idempotency_key::text || ':lot')::uuid     END;
    SELECT (CASE WHEN _kitchen_context_v1(p_section_id, p_product_id) THEN
      _kitchen_stock_lot_v1(p_product_id, v_actual_yield, v_product_unit, NULL, NULL, p_batch_number, v_lot_idem_key, '{}'::jsonb)
      ELSE create_stock_lot_v1(       p_product_id      := p_product_id,       p_quantity        := v_actual_yield,
      p_unit            := v_product_unit,       p_location_id     := NULL,       p_expires_at      := NULL,
      p_batch_number    := p_batch_number,       p_idempotency_key := v_lot_idem_key,       p_metadata        := '{}'::JSONB
    ) END->>'lot_id')::uuid INTO v_lot_id;   END IF;   v_production_number := 'PROD-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')     || '-'     || lpad(nextval('production_records_seq')::text, 4, '0');
  SELECT id INTO v_recipe_version_id     FROM recipe_versions    WHERE product_id = p_product_id
   ORDER BY version_number DESC    LIMIT 1;   BEGIN
    INSERT INTO production_records (       production_number, product_id, quantity_produced, quantity_waste,       production_date, section_id, staff_id, batch_number, notes,
      idempotency_key, materials_consumed, stock_updated, je_posted,       recipe_version_id, materials_breakdown,       expected_yield_qty, actual_yield_qty, yield_variance_reason,
      waste_reason     ) VALUES (       v_production_number, p_product_id, p_quantity_produced, p_quantity_waste,
      now(), p_section_id, v_profile, p_batch_number, p_notes,       p_idempotency_key, FALSE, FALSE, FALSE,       v_recipe_version_id, v_breakdown,
      v_expected_yield, v_actual_yield, v_yield_reason,       p_waste_reason     ) RETURNING id INTO v_production_id;
  EXCEPTION WHEN unique_violation THEN     SELECT * INTO v_existing_row FROM production_records       WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_row.id IS NULL THEN       RAISE;     END IF;
    SELECT COUNT(*) INTO v_movements_count       FROM stock_movements       WHERE reference_type = 'production' AND reference_id = v_existing_row.id;
    RETURN jsonb_build_object(       'production_id',         v_existing_row.id,       'production_number',     v_existing_row.production_number,
      'movements_count',       v_movements_count,       'idempotent_replay',     true,       'expected_yield_qty',    v_existing_row.expected_yield_qty,
      'actual_yield_qty',      v_existing_row.actual_yield_qty,       'yield_variance_pct',    v_existing_row.yield_variance_pct,       'yield_variance_reason', v_existing_row.yield_variance_reason,
      'waste_reason',          v_existing_row.waste_reason     );   END;
  SELECT COALESCE(SUM(total_consumed * material_cost), 0)::DECIMAL(14,2)     INTO v_total_consumed FROM _leaf_consumption;   v_waste_target := CASE
    WHEN p_quantity_waste > 0 AND v_total_factor > 0       THEN round_idr(v_total_consumed * p_quantity_waste / v_total_factor)     ELSE 0
  END;   v_unit_cost_in := CASE     WHEN v_actual_yield > 0 THEN round((v_total_consumed - v_waste_target) / v_actual_yield, 2)
    ELSE NULL   END;   v_in_result := record_stock_movement_v1(
    p_product_id      := p_product_id,     p_movement_type   := 'production_in',     p_quantity        := v_actual_yield,
    p_reason          := 'Production batch ' || v_production_number,     p_unit_cost       := v_unit_cost_in,     p_supplier_id     := NULL,
    p_idempotency_key := p_idempotency_key,     p_unit            := v_product_unit,     p_from_section_id := NULL,
    p_to_section_id   := p_section_id,     p_metadata        := jsonb_build_object(                           'production_id',       v_production_id,
                          'production_number',   v_production_number,                           'batch_number',        p_batch_number,                           'expected_yield_qty',  v_expected_yield,
                          'actual_yield_qty',    v_actual_yield,                           'waste_reason',        p_waste_reason                          ),
    p_lot_id          := v_lot_id   );   v_movement_id := (v_in_result->>'movement_id')::uuid;
  v_in_movement_id := v_movement_id;   v_movement_ids := array_append(v_movement_ids, v_movement_id);   v_movements_count := v_movements_count + 1;
  IF v_waste_target > 0 THEN     v_waste_cost := v_total_consumed - round_idr(COALESCE(v_unit_cost_in, 0) * v_actual_yield);     IF v_waste_cost > 0 THEN
      SELECT created_at::date INTO v_waste_je_date         FROM stock_movements WHERE id = v_in_movement_id;       PERFORM check_fiscal_period_open(v_waste_je_date);
      v_waste_entry_no := next_journal_entry_number(v_waste_je_date);       INSERT INTO journal_entries (         entry_number, entry_date, description, reference_type, reference_id,
        status, total_debit, total_credit, created_by, metadata       ) VALUES (         v_waste_entry_no,
        v_waste_je_date,         'Production waste ' || v_production_number,         'stock_movement',
        v_in_movement_id,         'posted',         v_waste_cost,
        v_waste_cost,         v_profile,         jsonb_build_object(
          'movement_type',     'production_waste',           'production_id',     v_production_id,           'production_number', v_production_number,
          'quantity_waste',    p_quantity_waste,           'waste_reason',      p_waste_reason         )
      ) RETURNING id INTO v_waste_je_id;       INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES         (v_waste_je_id, resolve_mapping_account('WASTE_EXPENSE'),  v_waste_cost, 0,
         'Production waste expense'),         (v_waste_je_id, resolve_mapping_account('PRODUCTION_COGS'), 0, v_waste_cost,          'Waste share not capitalised into finished goods');
    ELSE       v_waste_cost := 0;     END IF;
  END IF;   FOR v_rec IN SELECT * FROM _leaf_consumption ORDER BY material_name LOOP     v_out_result := record_stock_movement_v1(
      p_product_id      := v_rec.material_id,       p_movement_type   := 'production_out',       p_quantity        := -v_rec.total_consumed,
      p_reason          := 'Material consumed by ' || v_production_number,       p_unit_cost       := v_rec.material_cost,       p_supplier_id     := NULL,
      p_idempotency_key := NULL,       p_unit            := v_rec.material_unit,       p_from_section_id := p_section_id,
      p_to_section_id   := NULL,       p_metadata        := jsonb_build_object(                             'production_id',     v_production_id,
                            'production_number', v_production_number,                             'material_id',       v_rec.material_id,                             'cascade',           p_recurse_subrecipes
                           ),       p_lot_id          := NULL,       p_allow_negative  := v_allow_negative
    );     v_movement_id := (v_out_result->>'movement_id')::uuid;     v_movement_ids := array_append(v_movement_ids, v_movement_id);
    v_movements_count := v_movements_count + 1;   END LOOP;   UPDATE production_records
    SET materials_consumed = TRUE,         stock_updated      = TRUE,         updated_at         = now()
    WHERE id = v_production_id;   SELECT COUNT(*) INTO v_je_count     FROM journal_entries
    WHERE reference_type = 'stock_movement'       AND reference_id = ANY(v_movement_ids);   IF v_je_count > 0 THEN
    UPDATE production_records SET je_posted = TRUE, updated_at = now()       WHERE id = v_production_id;   END IF;
  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)   VALUES (     'production.create', 'production_records', v_production_id,
    jsonb_build_object(       'production_number',     v_production_number,       'product_id',            p_product_id,
      'quantity_produced',     p_quantity_produced,       'quantity_waste',        p_quantity_waste,       'waste_reason',          p_waste_reason,
      'waste_expense',         v_waste_cost,       'section_id',            p_section_id,       'batch_number',          p_batch_number,
      'movements_count',       v_movements_count,       'je_count',              v_je_count,       'lot_id',                v_lot_id,
      'idempotency_key',       p_idempotency_key,       'recurse_subrecipes',    p_recurse_subrecipes,       'cascade_rule',          'adr016_stop_at_stocked',
      'recipe_version_id',     v_recipe_version_id,       'depth_reached',         v_max_depth_reached,       'expected_yield_qty',    v_expected_yield,
      'actual_yield_qty',      v_actual_yield,       'yield_variance_reason', v_yield_reason,       'force_negative',        v_allow_negative,
      'shortages',             CASE WHEN v_allow_negative THEN v_missing ELSE '[]'::JSONB END     ),     v_profile
  );   RETURN jsonb_build_object(     'production_id',         v_production_id,
    'production_number',     v_production_number,     'lot_id',                v_lot_id,     'movements_count',       v_movements_count,
    'je_count',              v_je_count,     'idempotent_replay',     false,     'recipe_version_id',     v_recipe_version_id,
    'depth_reached',         v_max_depth_reached,     'materials_breakdown',   v_breakdown,     'expected_yield_qty',    v_expected_yield,
    'actual_yield_qty',      v_actual_yield,     'yield_variance_reason', v_yield_reason,     'waste_reason',          p_waste_reason,
    'waste_expense',         v_waste_cost,     'materials_cost',        v_total_consumed,     'forced_negative',       v_allow_negative,
    'shortages',             CASE WHEN v_allow_negative THEN v_missing ELSE '[]'::JSONB END   ); END $function$
;
REVOKE ALL ON FUNCTION stock_private.record_production_v7(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text, p_quantity_waste numeric, p_notes text, p_idempotency_key uuid, p_recurse_subrecipes boolean, p_expected_yield_qty numeric, p_actual_yield_qty numeric, p_yield_variance_reason text, p_force_negative boolean, p_waste_reason waste_reason) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_production_v8(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text DEFAULT NULL::text, p_quantity_waste numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_recurse_subrecipes boolean DEFAULT true, p_expected_yield_qty numeric DEFAULT NULL::numeric, p_actual_yield_qty numeric DEFAULT NULL::numeric, p_yield_variance_reason text DEFAULT NULL::text, p_force_negative boolean DEFAULT false, p_waste_reason waste_reason DEFAULT NULL::waste_reason) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.record_production_v7(p_product_id,p_quantity_produced,p_section_id,p_batch_number,p_quantity_waste,p_notes,p_idempotency_key,p_recurse_subrecipes,p_expected_yield_qty,p_actual_yield_qty,p_yield_variance_reason,p_force_negative,p_waste_reason));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.record_production_v7(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text, p_quantity_waste numeric, p_notes text, p_idempotency_key uuid, p_recurse_subrecipes boolean, p_expected_yield_qty numeric, p_actual_yield_qty numeric, p_yield_variance_reason text, p_force_negative boolean, p_waste_reason waste_reason);
REVOKE ALL ON FUNCTION public.record_production_v8(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text, p_quantity_waste numeric, p_notes text, p_idempotency_key uuid, p_recurse_subrecipes boolean, p_expected_yield_qty numeric, p_actual_yield_qty numeric, p_yield_variance_reason text, p_force_negative boolean, p_waste_reason waste_reason) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_production_v8(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text, p_quantity_waste numeric, p_notes text, p_idempotency_key uuid, p_recurse_subrecipes boolean, p_expected_yield_qty numeric, p_actual_yield_qty numeric, p_yield_variance_reason text, p_force_negative boolean, p_waste_reason waste_reason) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.update_product_v4(p_product_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id      UUID := auth.uid();
  -- Lot 6b : 'tax_inclusive' retiré (flag produit déprécié — le mode fiscal
  -- est global, business_config.tax_inclusive ; patch renvoyé en ignored_fields).
  v_allowed_fields CONSTANT TEXT[] := ARRAY[
    'name', 'sku', 'category_id', 'description',
    'retail_price', 'wholesale_price', 'image_url',
    'is_active', 'is_favorite', 'is_semi_finished',
    'visible_on_pos', 'available_for_sale', 'track_inventory', 'deduct_stock',
    'is_display_item', 'dispatch_stations',
    'min_stock_threshold', 'target_gross_margin_pct', 'default_shelf_life_hours'
  ];
  v_key TEXT; v_ignored_fields TEXT[] := ARRAY[]::TEXT[]; v_product products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed_fields)) THEN v_ignored_fields := array_append(v_ignored_fields, v_key); END IF;
  END LOOP;
  IF p_patch ? 'name' AND NULLIF(trim(p_patch->>'name'), '') IS NULL
     OR p_patch ? 'sku' AND NULLIF(trim(p_patch->>'sku'), '') IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE='22023', HINT='name and sku must not be blank';
  END IF;
  IF p_patch ? 'retail_price' AND (
    p_patch->>'retail_price' IS NULL OR (p_patch->>'retail_price')::NUMERIC < 0
    OR (p_patch->>'retail_price')::NUMERIC::TEXT IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RAISE EXCEPTION 'invalid_retail_price' USING ERRCODE='22023', HINT='retail_price must be finite and >= 0';
  END IF;
  UPDATE products SET
    name = COALESCE((p_patch->>'name')::TEXT, name),
    sku = COALESCE((p_patch->>'sku')::TEXT, sku),
    category_id = COALESCE((p_patch->>'category_id')::UUID, category_id),
    description = CASE WHEN p_patch ? 'description' THEN (p_patch->>'description')::TEXT ELSE description END,
    retail_price = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
    wholesale_price = CASE WHEN p_patch ? 'wholesale_price' THEN (p_patch->>'wholesale_price')::NUMERIC ELSE wholesale_price END,
    image_url = CASE WHEN p_patch ? 'image_url' THEN (p_patch->>'image_url')::TEXT ELSE image_url END,
    is_active = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    is_favorite = COALESCE((p_patch->>'is_favorite')::BOOLEAN, is_favorite),
    is_semi_finished = COALESCE((p_patch->>'is_semi_finished')::BOOLEAN, is_semi_finished),
    visible_on_pos = COALESCE((p_patch->>'visible_on_pos')::BOOLEAN, visible_on_pos),
    available_for_sale = COALESCE((p_patch->>'available_for_sale')::BOOLEAN, available_for_sale),
    track_inventory = COALESCE((p_patch->>'track_inventory')::BOOLEAN, track_inventory),
    deduct_stock = COALESCE((p_patch->>'deduct_stock')::BOOLEAN, deduct_stock),
    is_display_item = COALESCE((p_patch->>'is_display_item')::BOOLEAN, is_display_item),
    -- Override multi-station : clé présente => pose (array) ou efface (null) ; absente => inchangé.
    dispatch_stations = CASE
      WHEN p_patch ? 'dispatch_stations'
      THEN (CASE WHEN jsonb_typeof(p_patch->'dispatch_stations') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'dispatch_stations'))
                 ELSE NULL END)
      ELSE dispatch_stations END,
    min_stock_threshold = COALESCE((p_patch->>'min_stock_threshold')::NUMERIC, min_stock_threshold),
    target_gross_margin_pct = CASE WHEN p_patch ? 'target_gross_margin_pct' THEN (p_patch->>'target_gross_margin_pct')::NUMERIC ELSE target_gross_margin_pct END,
    default_shelf_life_hours = CASE WHEN p_patch ? 'default_shelf_life_hours' THEN (p_patch->>'default_shelf_life_hours')::INTEGER ELSE default_shelf_life_hours END,
    updated_at = now()
  WHERE id = p_product_id RETURNING * INTO v_product;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, 'product.update', 'product', p_product_id, p_patch, jsonb_build_object('ignored_fields', v_ignored_fields));
  RETURN jsonb_build_object('product', to_jsonb(v_product), 'ignored_fields', to_jsonb(v_ignored_fields));
END $function$
;
REVOKE ALL ON FUNCTION stock_private.update_product_v4(p_product_id uuid, p_patch jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.update_product_v5(p_product_id uuid, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.update_product_v4(p_product_id,p_patch));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.update_product_v4(p_product_id uuid, p_patch jsonb);
REVOKE ALL ON FUNCTION public.update_product_v5(p_product_id uuid, p_patch jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_product_v5(p_product_id uuid, p_patch jsonb) TO authenticated;


