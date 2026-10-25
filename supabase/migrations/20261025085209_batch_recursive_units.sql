-- Corps live ; conversions cohérentes et fermeture des appelants versionnés.
CREATE OR REPLACE FUNCTION public.record_batch_production_v9(p_batch jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE   v_uid              UUID := auth.uid();   v_profile          UUID;
  v_batch_id         UUID;   v_batch_number     TEXT;   v_batch_notes      TEXT;
  v_batch_idem_key   UUID;   v_existing_batch   production_batches%ROWTYPE;   v_item             jsonb;
  v_item_idx         INT;   v_product_id       UUID;   v_quantity         NUMERIC;
  v_waste            NUMERIC;   v_waste_reason     public.waste_reason;   v_waste_reason_txt TEXT;
  v_expected_yield   NUMERIC;   v_actual_yield     NUMERIC;   v_variance_reason  TEXT;
  v_item_idem_key    UUID;   v_section_id       UUID;   v_records          JSONB := '[]'::JSONB;
  v_rec_result       JSONB;   v_production_id    UUID;   v_shortages        JSONB := '[]'::JSONB;
  v_truncated        INT := 0;   v_agg              RECORD;   v_allow_negative   BOOLEAN;
  v_production_date  TIMESTAMPTZ;   v_patched          INT := 0; BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.create') AND NOT _kitchen_context_v1((p_batch->>'section_id')::uuid) THEN     RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';   END IF;
  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'object' THEN     RAISE EXCEPTION 'invalid_batch_envelope' USING ERRCODE='P0001';   END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN     RAISE EXCEPTION 'items_must_be_non_empty_array' USING ERRCODE='P0001';   END IF;
  IF (p_batch ? 'production_date')      AND NULLIF(p_batch->>'production_date', '') IS NOT NULL THEN     BEGIN
      v_production_date := (p_batch->>'production_date')::timestamptz;     EXCEPTION WHEN others THEN       RAISE EXCEPTION 'invalid_production_date' USING ERRCODE='P0001',
        HINT = 'production_date must be an ISO-8601 timestamp';     END;   END IF;
  v_allow_negative := FALSE;   IF p_batch ? 'force_negative' THEN     IF jsonb_typeof(p_batch->'force_negative') <> 'boolean' THEN
      RAISE EXCEPTION 'invalid_force_negative' USING ERRCODE='P0001',         HINT = 'force_negative must be a JSON boolean';     END IF;
    v_allow_negative := (p_batch->>'force_negative')::boolean;   END IF;   IF v_allow_negative AND NOT has_permission(v_uid, 'inventory.production.force_negative') THEN
    RAISE EXCEPTION 'force_negative_forbidden' USING ERRCODE='P0003',       HINT = 'inventory.production.force_negative is required to produce below stock';   END IF;
  v_batch_notes := p_batch->>'notes';   IF (p_batch->>'section_id') IS NOT NULL AND length(p_batch->>'section_id') > 0 THEN     v_section_id := (p_batch->>'section_id')::uuid;
  END IF;   IF v_section_id IS NULL THEN     RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001',
      HINT = 'production movements require a section (chk_stock_movements_section_required)';   END IF;   IF (p_batch->>'idempotency_key') IS NOT NULL AND length(p_batch->>'idempotency_key') > 0 THEN
    v_batch_idem_key := (p_batch->>'idempotency_key')::uuid;   END IF;   IF v_batch_idem_key IS NOT NULL THEN
    SELECT * INTO v_existing_batch FROM production_batches       WHERE idempotency_key = v_batch_idem_key LIMIT 1;     IF v_existing_batch.id IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(         jsonb_build_object(           'production_id',     pr.id,
          'production_number', pr.production_number,           'product_id',        pr.product_id,           'quantity_produced', pr.quantity_produced,
          'quantity_waste',    pr.quantity_waste,           'waste_reason',      pr.waste_reason         )
      ORDER BY pr.created_at), '[]'::JSONB)         INTO v_records         FROM production_records pr
        WHERE pr.batch_id = v_existing_batch.id;       RETURN jsonb_build_object(         'batch_id',           v_existing_batch.id,
        'batch_number',       v_existing_batch.batch_number,         'status',             v_existing_batch.status,         'production_records', v_records,
        'idempotent_replay',  TRUE       );     END IF;
  END IF;   SELECT id INTO v_profile FROM user_profiles     WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN     RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';   END IF;
  DROP TABLE IF EXISTS pg_temp._batch_items;   CREATE TEMP TABLE _batch_items (     item_idx          INT     PRIMARY KEY,
    product_id        UUID    NOT NULL,     quantity_produced NUMERIC NOT NULL,     quantity_waste    NUMERIC NOT NULL,
    waste_reason      public.waste_reason,     expected_yield    NUMERIC,     actual_yield      NUMERIC,
    variance_reason   TEXT,     item_idem_key     UUID   ) ON COMMIT DROP;
  v_item_idx := 0;   FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP     v_item_idx := v_item_idx + 1;
    IF jsonb_typeof(v_item) <> 'object' THEN       RAISE EXCEPTION 'invalid_item_shape' USING ERRCODE='P0001',         DETAIL = format('Item #%s is not a JSON object', v_item_idx);
    END IF;     IF (v_item->>'product_id') IS NULL OR length(v_item->>'product_id') = 0 THEN       RAISE EXCEPTION 'item_missing_product_id' USING ERRCODE='P0001',
        DETAIL = format('Item #%s', v_item_idx);     END IF;     v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := COALESCE((v_item->>'quantity_produced')::numeric, 0);     v_waste      := COALESCE((v_item->>'quantity_waste')::numeric, 0);     IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001',         DETAIL = format('Item #%s product=%s', v_item_idx, v_product_id);     END IF;
    IF v_waste < 0 THEN       RAISE EXCEPTION 'waste_must_be_non_negative' USING ERRCODE='P0001',         DETAIL = format('Item #%s product=%s', v_item_idx, v_product_id);
    END IF;     v_waste_reason_txt := NULLIF(v_item->>'waste_reason', '');     v_waste_reason := NULL;
    IF v_waste_reason_txt IS NOT NULL THEN       BEGIN         v_waste_reason := v_waste_reason_txt::public.waste_reason;
      EXCEPTION WHEN invalid_text_representation THEN         RAISE EXCEPTION 'invalid_waste_reason' USING ERRCODE='P0001',           DETAIL = format('Item #%s product=%s value=%s', v_item_idx, v_product_id, v_waste_reason_txt);
      END;     END IF;     IF v_waste > 0 AND v_waste_reason IS NULL THEN
      RAISE EXCEPTION 'waste_reason_required' USING ERRCODE='P0001',         DETAIL = format('Item #%s product=%s', v_item_idx, v_product_id);     END IF;
    IF NOT EXISTS (       SELECT 1 FROM recipes         WHERE product_id = v_product_id
          AND is_active = TRUE           AND deleted_at IS NULL     ) THEN
      RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002',         DETAIL = format('Item #%s product=%s has no active recipe', v_item_idx, v_product_id);     END IF;
    IF NOT (SELECT COALESCE(deduct_stock, true) FROM products WHERE id = v_product_id) THEN       RAISE EXCEPTION 'production_requires_deduct_stock' USING ERRCODE='P0001',         DETAIL = format('Item #%s product=%s', v_item_idx, v_product_id);
    END IF;     v_expected_yield  := NULLIF(v_item->>'expected_yield_qty', '')::numeric;     v_actual_yield    := NULLIF(v_item->>'actual_yield_qty',   '')::numeric;
    v_variance_reason := NULLIF(v_item->>'yield_variance_reason', '');     v_item_idem_key   := NULLIF(v_item->>'idempotency_key',     '')::uuid;     INSERT INTO _batch_items VALUES (
      v_item_idx, v_product_id, v_quantity, v_waste, v_waste_reason,       v_expected_yield, v_actual_yield, v_variance_reason, v_item_idem_key     );
  END LOOP;   WITH RECURSIVE     items AS (
      SELECT bi.product_id, (bi.quantity_produced + bi.quantity_waste) AS factor         FROM _batch_items bi         JOIN products p ON p.id = bi.product_id
    ),     flatten AS (       SELECT
        i.product_id AS root_product_id,         r.material_id,         m.name AS material_name,
        m.unit AS material_unit,         m.current_stock AS material_stock,         r.unit AS recipe_unit,
        (r.quantity * i.factor)::DECIMAL(20,6) AS qty_in_recipe_unit,         1 AS depth,         ARRAY[i.product_id]::UUID[] AS sub_path,
        EXISTS (           SELECT 1 FROM recipes r2             WHERE r2.product_id = r.material_id
              AND r2.is_active = TRUE AND r2.deleted_at IS NULL         ) AS is_intermediate,         COALESCE(m.track_inventory, TRUE) AS is_stocked
      FROM items i       JOIN recipes r ON r.product_id = i.product_id       JOIN products m ON m.id = r.material_id
      WHERE r.is_active = TRUE AND r.deleted_at IS NULL       UNION ALL       SELECT
        f.root_product_id,         r.material_id,         m.name,
        m.unit,         m.current_stock,         r.unit,
        (convert_quantity(f.qty_in_recipe_unit, f.recipe_unit, f.material_unit) * r.quantity)::DECIMAL(20,6),         f.depth + 1,         f.sub_path || f.material_id,
        EXISTS (           SELECT 1 FROM recipes r2             WHERE r2.product_id = r.material_id
              AND r2.is_active = TRUE AND r2.deleted_at IS NULL         ),         COALESCE(m.track_inventory, TRUE)
      FROM flatten f       JOIN recipes r ON r.product_id = f.material_id       JOIN products m ON m.id = r.material_id
      WHERE f.is_intermediate = TRUE         AND f.is_stocked = FALSE         AND r.is_active = TRUE AND r.deleted_at IS NULL
        AND f.depth < 5         AND NOT (r.material_id = ANY(f.sub_path))     ),
    truncated AS (       SELECT COUNT(*) AS n         FROM flatten
       WHERE depth = 5          AND is_intermediate = TRUE          AND is_stocked = FALSE
    ),     leaves AS (       SELECT
        material_id,         MAX(material_name)  AS material_name,         MAX(material_unit)  AS material_unit,
        MAX(material_stock) AS material_stock,         SUM(           CASE WHEN recipe_unit = material_unit
               THEN qty_in_recipe_unit                ELSE convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit)           END
        )::DECIMAL(14,3) AS total_required       FROM flatten       WHERE is_intermediate = FALSE OR is_stocked = TRUE
      GROUP BY material_id     )   SELECT
    (SELECT n FROM truncated),     COALESCE(jsonb_agg(       jsonb_build_object(
        'material_id',   material_id,         'material_name', material_name,         'required',      total_required,
        'available',     material_stock,         'shortfall',     total_required - material_stock,         'unit',          material_unit
      ) ORDER BY material_name), '[]'::JSONB)     INTO v_truncated, v_shortages     FROM leaves
    WHERE material_stock < total_required;   IF v_truncated > 0 THEN     RAISE EXCEPTION 'recipe_depth_exceeded' USING ERRCODE='P0001',
      DETAIL = format('%s unexpanded intermediate(s) remain at depth 5 in this batch.', v_truncated);   END IF;   IF NOT v_allow_negative AND jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL = v_shortages::text;   END IF;   v_batch_number := 'BATCH-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')     || '-'     || lpad(nextval('production_batches_seq')::text, 4, '0');
  BEGIN     INSERT INTO production_batches (       batch_number, started_at, staff_id, status, notes, idempotency_key
    ) VALUES (       v_batch_number, now(), v_profile, 'open', v_batch_notes, v_batch_idem_key     ) RETURNING id INTO v_batch_id;
  EXCEPTION WHEN unique_violation THEN     SELECT * INTO v_existing_batch FROM production_batches       WHERE idempotency_key = v_batch_idem_key LIMIT 1;
    IF v_existing_batch.id IS NULL THEN       RAISE;     END IF;
    SELECT COALESCE(jsonb_agg(       jsonb_build_object(         'production_id',     pr.id,
        'production_number', pr.production_number,         'product_id',        pr.product_id,         'quantity_produced', pr.quantity_produced,
        'quantity_waste',    pr.quantity_waste,         'waste_reason',      pr.waste_reason       )
    ORDER BY pr.created_at), '[]'::JSONB)       INTO v_records       FROM production_records pr
      WHERE pr.batch_id = v_existing_batch.id;     RETURN jsonb_build_object(       'batch_id',           v_existing_batch.id,
      'batch_number',       v_existing_batch.batch_number,       'status',             v_existing_batch.status,       'production_records', v_records,
      'idempotent_replay',  TRUE     );   END;
  FOR v_agg IN SELECT * FROM _batch_items ORDER BY item_idx LOOP     v_rec_result := record_production_v7(       p_product_id            := v_agg.product_id,
      p_quantity_produced     := v_agg.quantity_produced,       p_section_id            := v_section_id,       p_batch_number          := v_batch_number,
      p_quantity_waste        := v_agg.quantity_waste,       p_notes                 := v_batch_notes,       p_idempotency_key       := v_agg.item_idem_key,
      p_recurse_subrecipes    := TRUE,       p_expected_yield_qty    := v_agg.expected_yield,       p_actual_yield_qty      := v_agg.actual_yield,
      p_yield_variance_reason := v_agg.variance_reason,       p_force_negative        := v_allow_negative,       p_waste_reason          := v_agg.waste_reason
    );     v_production_id := (v_rec_result->>'production_id')::uuid;     UPDATE production_records
       SET batch_id   = v_batch_id,            updated_at = now()      WHERE id = v_production_id;
    v_records := v_records || jsonb_build_array(jsonb_build_object(       'production_id',     v_production_id,       'production_number', v_rec_result->>'production_number',
      'product_id',        v_agg.product_id,       'quantity_produced', v_agg.quantity_produced,       'quantity_waste',    v_agg.quantity_waste,
      'waste_reason',      v_agg.waste_reason,       'waste_expense',     v_rec_result->'waste_expense',       'movements_count',   v_rec_result->'movements_count',
      'lot_id',            v_rec_result->'lot_id'     ));   END LOOP;
  UPDATE production_batches      SET status       = 'completed',          completed_at = now(),
         updated_at   = now()    WHERE id = v_batch_id;   IF v_production_date IS NOT NULL THEN
    UPDATE production_records        SET production_date = v_production_date,            updated_at      = now()
     WHERE batch_id = v_batch_id;     GET DIAGNOSTICS v_patched = ROW_COUNT;   END IF;
  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)   VALUES (     'production.batch.create', 'production_batches', v_batch_id,
    jsonb_build_object(       'batch_number',       v_batch_number,       'items_count',        jsonb_array_length(p_items),
      'section_id',         v_section_id,       'idempotency_key',    v_batch_idem_key,       'production_records', v_records,
      'force_negative',     v_allow_negative,       'cascade_rule',       'adr016_stop_at_stocked',       'production_date',    v_production_date,
      'shortages',          CASE WHEN v_allow_negative THEN v_shortages ELSE '[]'::JSONB END     ),     v_profile
  );   RETURN jsonb_build_object(     'batch_id',                 v_batch_id,
    'batch_number',             v_batch_number,     'status',                   'completed',     'production_records',       v_records,
    'idempotent_replay',        FALSE,     'forced_negative',          v_allow_negative,     'production_date',          v_production_date,
    'production_date_patched',  v_patched,     'shortages',                CASE WHEN v_allow_negative THEN v_shortages ELSE '[]'::JSONB END   );
END $function$
;
REVOKE ALL ON FUNCTION public.record_batch_production_v9(p_batch jsonb, p_items jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_batch_production_v9(p_batch jsonb, p_items jsonb) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.record_batch_production_v8(p_batch jsonb, p_items jsonb);
