-- 20260517000063_create_record_production_rpc.sql
-- Session 13 / Phase 2.A — record_production_v1 atomic RPC.
--
-- Atomic production record :
--   1. Resolve recipe rows (active, non-deleted).
--   2. Validate stock availability for each material (consumed = recipe.qty
--      * (quantity_produced + quantity_waste), converted via convert_quantity()).
--   3. If insufficient → raise insufficient_stock with JSON detail of missing items.
--   4. If product has default_shelf_life_hours, call create_stock_lot_v1 UPFRONT
--      for the produced quantity and use the returned lot_id on production_in.
--   5. Insert production_records row, generate PROD-YYYYMMDD-NNNN number.
--   6. Call record_stock_movement_v1 for production_in (+quantity_produced).
--   7. For each recipe row, call record_stock_movement_v1 for production_out
--      (-consumed, lot_id=NULL → FIFO resolved by primitive if F1-tracked).
--   8. Flip materials_consumed=true, stock_updated=true.
--   9. Verify trigger emitted JEs (count via reference_id IN movement_ids) and
--      flip je_posted=true accordingly.
--   10. Return JSONB { production_id, production_number, lot_id, movements_count,
--                       je_count, idempotent_replay:false }.
--
-- Idempotency : same p_idempotency_key returns the existing production_records
-- row without re-running side effects (replay safety on flaky clients).
--
-- Sub-plan decisions D-2A-3..D-2A-7. The JE trigger tr_20_je_emit (migration
-- 000023) emits per-movement JEs ; this RPC does NOT post JEs explicitly.

CREATE OR REPLACE FUNCTION record_production_v1(
  p_product_id        UUID,
  p_quantity_produced DECIMAL(10,3),
  p_section_id        UUID,
  p_batch_number      TEXT          DEFAULT NULL,
  p_quantity_waste    DECIMAL(10,3) DEFAULT 0,
  p_notes             TEXT          DEFAULT NULL,
  p_idempotency_key   UUID          DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile          UUID;
  v_product_unit     TEXT;
  v_product_cost     DECIMAL(14,2);
  v_product_shelf    INT;
  v_product_type     TEXT;
  v_production_id    UUID;
  v_production_number TEXT;
  v_existing_pr      UUID;
  v_lot_id           UUID;
  v_lot_idem_key     UUID;
  v_total_factor     DECIMAL(14,4);
  v_recipe_count     INT;
  v_missing          JSONB := '[]'::JSONB;
  v_movements_count  INT := 0;
  v_je_count         INT;
  v_movement_ids     UUID[] := ARRAY[]::UUID[];
  v_movement_id      UUID;
  v_in_result        JSONB;
  v_out_result       JSONB;
  v_rec              RECORD;
  v_consumed         DECIMAL(14,3);
BEGIN
  -- Permission gate.
  IF NOT has_permission(v_uid, 'inventory.production.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Validate quantities.
  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
  END IF;
  IF p_quantity_waste IS NULL OR p_quantity_waste < 0 THEN
    RAISE EXCEPTION 'waste_must_be_non_negative' USING ERRCODE='P0001';
  END IF;

  -- Idempotency replay.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, production_number INTO v_existing_pr, v_production_number
      FROM production_records
      WHERE idempotency_key = p_idempotency_key
      LIMIT 1;
    IF v_existing_pr IS NOT NULL THEN
      SELECT COUNT(*) INTO v_movements_count
        FROM stock_movements
        WHERE reference_type = 'production' AND reference_id = v_existing_pr;
      RETURN jsonb_build_object(
        'production_id',     v_existing_pr,
        'production_number', v_production_number,
        'movements_count',   v_movements_count,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- Resolve actor profile.
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Resolve product.
  SELECT unit, cost_price, default_shelf_life_hours, product_type
    INTO v_product_unit, v_product_cost, v_product_shelf, v_product_type
    FROM products
    WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  -- Section existence (NULL allowed → no section_stock side-effect).
  IF p_section_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sections WHERE id = p_section_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE='P0002';
  END IF;

  -- Resolve active recipes.
  SELECT COUNT(*) INTO v_recipe_count
    FROM recipes r
    WHERE r.product_id = p_product_id
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL;
  IF v_recipe_count = 0 THEN
    RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002';
  END IF;

  -- Total batch factor including waste : we still consume materials for waste.
  v_total_factor := p_quantity_produced + p_quantity_waste;

  -- Stock availability check : collect missing items.
  FOR v_rec IN
    SELECT r.material_id, r.quantity AS recipe_qty, r.unit AS recipe_unit,
           m.unit AS material_unit, m.current_stock, m.name AS material_name
      FROM recipes r
      JOIN products m ON m.id = r.material_id
      WHERE r.product_id = p_product_id
        AND r.is_active = TRUE
        AND r.deleted_at IS NULL
  LOOP
    BEGIN
      v_consumed := convert_quantity(
        v_rec.recipe_qty * v_total_factor,
        v_rec.recipe_unit,
        v_rec.material_unit
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'unit_conversion_failed' USING ERRCODE='P0002',
        DETAIL = format('material=% recipe_unit=% material_unit=%', v_rec.material_name, v_rec.recipe_unit, v_rec.material_unit);
    END;

    IF v_rec.current_stock < v_consumed THEN
      v_missing := v_missing || jsonb_build_object(
        'material_id',     v_rec.material_id,
        'material_name',   v_rec.material_name,
        'required',        v_consumed,
        'available',       v_rec.current_stock,
        'shortfall',       v_consumed - v_rec.current_stock,
        'unit',            v_rec.material_unit
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_missing) > 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL = v_missing::text;
  END IF;

  -- Create lot UPFRONT for the produced product if it has a default shelf life.
  IF v_product_shelf IS NOT NULL THEN
    -- Deterministic idem key derived from the production idempotency_key so
    -- a record_production_v1 replay path is safe even on lot creation.
    v_lot_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':lot')::uuid
    END;
    SELECT (create_stock_lot_v1(
      p_product_id      := p_product_id,
      p_quantity        := p_quantity_produced,
      p_unit            := v_product_unit,
      p_location_id     := NULL,
      p_expires_at      := NULL,
      p_batch_number    := p_batch_number,
      p_idempotency_key := v_lot_idem_key,
      p_metadata        := '{}'::JSONB
    )->>'lot_id')::uuid INTO v_lot_id;
  END IF;

  -- Generate production_number using sequence (date prefix is cosmetic).
  v_production_number := 'PROD-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('production_records_seq')::text, 4, '0');

  -- INSERT production_record.
  INSERT INTO production_records (
    production_number, product_id, quantity_produced, quantity_waste,
    production_date, section_id, staff_id, batch_number, notes,
    idempotency_key, materials_consumed, stock_updated, je_posted
  ) VALUES (
    v_production_number, p_product_id, p_quantity_produced, p_quantity_waste,
    now(), p_section_id, v_profile, p_batch_number, p_notes,
    p_idempotency_key, FALSE, FALSE, FALSE
  ) RETURNING id INTO v_production_id;

  -- production_in movement (+ quantity_produced for finished product).
  v_in_result := record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'production_in',
    p_quantity        := p_quantity_produced,
    p_reason          := 'Production batch ' || v_production_number,
    p_unit_cost       := v_product_cost,
    p_supplier_id     := NULL,
    p_idempotency_key := p_idempotency_key,
    p_unit            := v_product_unit,
    p_from_section_id := NULL,
    p_to_section_id   := p_section_id,
    p_metadata        := jsonb_build_object(
                          'production_id',     v_production_id,
                          'production_number', v_production_number,
                          'batch_number',      p_batch_number
                         ),
    p_lot_id          := v_lot_id
  );
  v_movement_id := (v_in_result->>'movement_id')::uuid;
  v_movement_ids := array_append(v_movement_ids, v_movement_id);
  v_movements_count := v_movements_count + 1;

  -- production_out movements (-consumed, one per recipe row).
  FOR v_rec IN
    SELECT r.material_id, r.quantity AS recipe_qty, r.unit AS recipe_unit,
           m.unit AS material_unit, m.cost_price AS material_cost, m.name AS material_name
      FROM recipes r
      JOIN products m ON m.id = r.material_id
      WHERE r.product_id = p_product_id
        AND r.is_active = TRUE
        AND r.deleted_at IS NULL
      ORDER BY m.name
  LOOP
    v_consumed := convert_quantity(
      v_rec.recipe_qty * v_total_factor,
      v_rec.recipe_unit,
      v_rec.material_unit
    );

    v_out_result := record_stock_movement_v1(
      p_product_id      := v_rec.material_id,
      p_movement_type   := 'production_out',
      p_quantity        := -v_consumed,
      p_reason          := 'Material consumed by ' || v_production_number,
      p_unit_cost       := v_rec.material_cost,
      p_supplier_id     := NULL,
      p_idempotency_key := NULL,
      p_unit            := v_rec.material_unit,
      p_from_section_id := p_section_id,
      p_to_section_id   := NULL,
      p_metadata        := jsonb_build_object(
                            'production_id',     v_production_id,
                            'production_number', v_production_number,
                            'material_id',       v_rec.material_id,
                            'recipe_qty',        v_rec.recipe_qty,
                            'recipe_unit',       v_rec.recipe_unit
                           ),
      p_lot_id          := NULL   -- let primitive resolve FIFO if F1-tracked
    );
    v_movement_id := (v_out_result->>'movement_id')::uuid;
    v_movement_ids := array_append(v_movement_ids, v_movement_id);
    v_movements_count := v_movements_count + 1;
  END LOOP;

  -- Update production_record flags.
  UPDATE production_records
    SET materials_consumed = TRUE,
        stock_updated      = TRUE,
        updated_at         = now()
    WHERE id = v_production_id;

  -- Count JEs the trigger emitted for our movements.
  SELECT COUNT(*) INTO v_je_count
    FROM journal_entries
    WHERE reference_type = 'stock_movement'
      AND reference_id = ANY(v_movement_ids);

  IF v_je_count > 0 THEN
    UPDATE production_records SET je_posted = TRUE, updated_at = now()
      WHERE id = v_production_id;
  END IF;

  -- Audit.
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'production.create', 'production_records', v_production_id,
    jsonb_build_object(
      'production_number', v_production_number,
      'product_id',        p_product_id,
      'quantity_produced', p_quantity_produced,
      'quantity_waste',    p_quantity_waste,
      'section_id',        p_section_id,
      'batch_number',      p_batch_number,
      'movements_count',   v_movements_count,
      'je_count',          v_je_count,
      'lot_id',            v_lot_id,
      'idempotency_key',   p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'production_id',     v_production_id,
    'production_number', v_production_number,
    'lot_id',            v_lot_id,
    'movements_count',   v_movements_count,
    'je_count',          v_je_count,
    'idempotent_replay', false
  );
END $$;

GRANT EXECUTE ON FUNCTION record_production_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION record_production_v1 FROM anon;

COMMENT ON FUNCTION record_production_v1 IS
  'Session 13 — Phase 2.A. Atomic production batch RPC. Resolves recipe, '
  'validates stock, creates lot upfront (if shelf-life set), inserts '
  'production_record + N+1 stock_movements via record_stock_movement_v1. '
  'JEs emitted by tr_20_je_emit trigger. Idempotent via p_idempotency_key. '
  'Gated by inventory.production.create (MANAGER+).';
