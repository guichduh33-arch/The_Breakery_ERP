-- 20260519000042_bump_record_production_yield_aware.sql
-- Session 15 / Phase 2.A — F5 Yield-aware record_production_v1.
--
-- Decisions :
--   D5  — JE source-of-truth = actual_yield_qty (not quantity_produced).
--         Implementation : the `production_in` stock_movement gets
--         `quantity := COALESCE(p_actual_yield_qty, p_quantity_produced)`. The
--         tr_20_je_emit trigger already reads `ABS(NEW.quantity)` so the JE Dr
--         Inventory finished-goods value reflects actual yield automatically. No
--         change required in tr_stock_movement_je() (see follow-up 043 doc).
--   D6  — yield_variance_reason is captured when |variance| > threshold ; the
--         RPC does NOT enforce the threshold (UI gate), but the CHECK on the
--         column requires min 5 chars when set.
--   D7  — Materials consumption stays based on `p_quantity_produced + p_quantity_waste`
--         (legacy semantic). Only the finished-product stock_in quantity flips to
--         actual. Rationale : if you bake 10kg instead of 12kg, you still
--         consumed the 12kg worth of materials (waste lives elsewhere).
--
-- Signature change : adds 3 trailing optional parameters with DEFAULT NULL :
--   p_expected_yield_qty   DECIMAL(10,3) DEFAULT NULL  -- planned ; falls back to p_quantity_produced
--   p_actual_yield_qty     DECIMAL(10,3) DEFAULT NULL  -- measured ; falls back to p_quantity_produced
--   p_yield_variance_reason TEXT         DEFAULT NULL  -- justification (UI gates by threshold)
--
-- Per CLAUDE.md RPC versioning : signature still `_v1`. Old 8-arg overload is
-- dropped to avoid resolution ambiguity. Callers passing only the original
-- params keep working (all new params have safe defaults).
--
-- Idempotency replay returns the same row including new yield fields.

-- Drop the previous 8-arg overload — required because we're changing the
-- signature within the same `_v1` per project convention.
DROP FUNCTION IF EXISTS record_production_v1(
  UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID, BOOLEAN
);

CREATE OR REPLACE FUNCTION record_production_v1(
  p_product_id            UUID,
  p_quantity_produced     DECIMAL(10,3),
  p_section_id            UUID,
  p_batch_number          TEXT          DEFAULT NULL,
  p_quantity_waste        DECIMAL(10,3) DEFAULT 0,
  p_notes                 TEXT          DEFAULT NULL,
  p_idempotency_key       UUID          DEFAULT NULL,
  p_recurse_subrecipes    BOOLEAN       DEFAULT TRUE,
  p_expected_yield_qty    DECIMAL(10,3) DEFAULT NULL,
  p_actual_yield_qty      DECIMAL(10,3) DEFAULT NULL,
  p_yield_variance_reason TEXT          DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile           UUID;
  v_product_unit      TEXT;
  v_product_cost      DECIMAL(14,2);
  v_product_shelf     INT;
  v_product_type      TEXT;
  v_production_id     UUID;
  v_production_number TEXT;
  v_existing_pr       UUID;
  v_lot_id            UUID;
  v_lot_idem_key      UUID;
  v_total_factor      DECIMAL(14,4);
  v_recipe_count      INT;
  v_missing           JSONB := '[]'::JSONB;
  v_movements_count   INT := 0;
  v_je_count          INT;
  v_movement_ids      UUID[] := ARRAY[]::UUID[];
  v_movement_id       UUID;
  v_in_result         JSONB;
  v_out_result        JSONB;
  v_rec               RECORD;
  v_breakdown         JSONB := '[]'::JSONB;
  v_recipe_version_id UUID;
  v_max_depth_const   CONSTANT INT := 5;
  v_max_depth_reached INT := 0;
  v_expected_yield    DECIMAL(10,3);
  v_actual_yield      DECIMAL(10,3);
  v_yield_reason      TEXT;
  v_existing_row      production_records%ROWTYPE;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
  END IF;
  IF p_quantity_waste IS NULL OR p_quantity_waste < 0 THEN
    RAISE EXCEPTION 'waste_must_be_non_negative' USING ERRCODE='P0001';
  END IF;
  IF p_expected_yield_qty IS NOT NULL AND p_expected_yield_qty <= 0 THEN
    RAISE EXCEPTION 'expected_yield_must_be_positive' USING ERRCODE='P0001';
  END IF;
  IF p_actual_yield_qty IS NOT NULL AND p_actual_yield_qty < 0 THEN
    RAISE EXCEPTION 'actual_yield_must_be_non_negative' USING ERRCODE='P0001';
  END IF;
  IF p_yield_variance_reason IS NOT NULL
     AND length(trim(p_yield_variance_reason)) < 5 THEN
    RAISE EXCEPTION 'variance_reason_too_short' USING ERRCODE='P0001';
  END IF;

  -- Resolve yield defaults (D5/D6). expected = p_quantity_produced (the recipe-
  -- scaled planned output) ; actual = p_quantity_produced (no-op when caller
  -- doesn't measure).
  v_expected_yield := COALESCE(p_expected_yield_qty, p_quantity_produced);
  v_actual_yield   := COALESCE(p_actual_yield_qty,   p_quantity_produced);
  v_yield_reason   := p_yield_variance_reason;

  -- Idempotency replay : return the existing row with yield fields included.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_row FROM production_records
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_row.id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_movements_count
        FROM stock_movements
        WHERE reference_type = 'production' AND reference_id = v_existing_row.id;
      RETURN jsonb_build_object(
        'production_id',         v_existing_row.id,
        'production_number',     v_existing_row.production_number,
        'movements_count',       v_movements_count,
        'idempotent_replay',     true,
        'expected_yield_qty',    v_existing_row.expected_yield_qty,
        'actual_yield_qty',      v_existing_row.actual_yield_qty,
        'yield_variance_pct',    v_existing_row.yield_variance_pct,
        'yield_variance_reason', v_existing_row.yield_variance_reason
      );
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT unit, cost_price, default_shelf_life_hours, product_type
    INTO v_product_unit, v_product_cost, v_product_shelf, v_product_type
    FROM products
    WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  IF p_section_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sections WHERE id = p_section_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT COUNT(*) INTO v_recipe_count
    FROM recipes r
    WHERE r.product_id = p_product_id
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL;
  IF v_recipe_count = 0 THEN
    RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002';
  END IF;

  -- Material consumption is based on the PLANNED produced + waste (D5 rationale :
  -- materials are consumed regardless of the eventual yield).
  v_total_factor := p_quantity_produced + p_quantity_waste;

  CREATE TEMP TABLE _bom_flatten (
    material_id    UUID,
    material_name  TEXT,
    material_unit  TEXT,
    material_cost  DECIMAL(14,2),
    material_stock DECIMAL(14,3),
    recipe_unit    TEXT,
    qty_in_recipe_unit DECIMAL(20,6),
    depth          INT,
    sub_path       UUID[],
    is_intermediate BOOLEAN
  ) ON COMMIT DROP;

  WITH RECURSIVE flatten AS (
    SELECT
      r.material_id,
      m.name AS material_name,
      m.unit AS material_unit,
      m.cost_price AS material_cost,
      m.current_stock AS material_stock,
      r.unit AS recipe_unit,
      (r.quantity * v_total_factor)::DECIMAL(20,6) AS qty_in_recipe_unit,
      1 AS depth,
      ARRAY[p_product_id]::UUID[] AS sub_path,
      EXISTS (
        SELECT 1 FROM recipes r2 WHERE r2.product_id = r.material_id
          AND r2.is_active = TRUE AND r2.deleted_at IS NULL
      ) AS is_intermediate
    FROM recipes r
    JOIN products m ON m.id = r.material_id
    WHERE r.product_id = p_product_id
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
    UNION ALL
    SELECT
      r.material_id,
      m.name,
      m.unit,
      m.cost_price,
      m.current_stock,
      r.unit,
      (f.qty_in_recipe_unit * r.quantity)::DECIMAL(20,6),
      f.depth + 1,
      f.sub_path || f.material_id,
      EXISTS (
        SELECT 1 FROM recipes r2 WHERE r2.product_id = r.material_id
          AND r2.is_active = TRUE AND r2.deleted_at IS NULL
      )
    FROM flatten f
    JOIN recipes r ON r.product_id = f.material_id
    JOIN products m ON m.id = r.material_id
    WHERE p_recurse_subrecipes = TRUE
      AND f.is_intermediate = TRUE
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
      AND f.depth < v_max_depth_const
      AND NOT (r.material_id = ANY(f.sub_path))
  )
  INSERT INTO _bom_flatten
  SELECT material_id, material_name, material_unit, material_cost, material_stock,
         recipe_unit, qty_in_recipe_unit, depth, sub_path, is_intermediate
    FROM flatten;

  SELECT COALESCE(MAX(depth), 0) INTO v_max_depth_reached FROM _bom_flatten;

  IF v_max_depth_reached > v_max_depth_const THEN
    RAISE EXCEPTION 'recipe_depth_exceeded' USING ERRCODE='P0001',
      DETAIL = format('Production cascade for product %s exceeded depth %s.', p_product_id, v_max_depth_const);
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'material_id',    material_id,
        'material_name',  material_name,
        'leaf',           NOT is_intermediate,
        'qty_per_unit',   CASE WHEN p_quantity_produced > 0
                              THEN (CASE WHEN recipe_unit = material_unit
                                         THEN qty_in_recipe_unit
                                         ELSE COALESCE(
                                           convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit),
                                           qty_in_recipe_unit
                                         )
                                    END / v_total_factor)
                              ELSE 0 END,
        'total_consumed', CASE WHEN recipe_unit = material_unit
                              THEN qty_in_recipe_unit
                              ELSE COALESCE(
                                convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit),
                                qty_in_recipe_unit
                              )
                          END,
        'unit',           material_unit,
        'depth',          depth,
        'sub_path',       to_jsonb(sub_path),
        'is_intermediate', is_intermediate
      )
      ORDER BY depth, material_name
    ),
    '[]'::JSONB
  ) INTO v_breakdown FROM _bom_flatten;

  CREATE TEMP TABLE _leaf_consumption (
    material_id    UUID PRIMARY KEY,
    material_name  TEXT,
    material_unit  TEXT,
    material_cost  DECIMAL(14,2),
    material_stock DECIMAL(14,3),
    total_consumed DECIMAL(14,3)
  ) ON COMMIT DROP;

  INSERT INTO _leaf_consumption (material_id, material_name, material_unit, material_cost, material_stock, total_consumed)
  SELECT
    f.material_id,
    MAX(f.material_name),
    MAX(f.material_unit),
    MAX(f.material_cost),
    MAX(f.material_stock),
    SUM(
      CASE
        WHEN f.recipe_unit = f.material_unit THEN f.qty_in_recipe_unit
        ELSE COALESCE(
          convert_quantity(f.qty_in_recipe_unit, f.recipe_unit, f.material_unit),
          f.qty_in_recipe_unit
        )
      END
    )::DECIMAL(14,3)
  FROM _bom_flatten f
  WHERE
    CASE
      WHEN p_recurse_subrecipes THEN f.is_intermediate = FALSE
      ELSE f.depth = 1
    END
  GROUP BY f.material_id;

  FOR v_rec IN SELECT * FROM _leaf_consumption LOOP
    IF v_rec.material_stock < v_rec.total_consumed THEN
      v_missing := v_missing || jsonb_build_object(
        'material_id',   v_rec.material_id,
        'material_name', v_rec.material_name,
        'required',      v_rec.total_consumed,
        'available',     v_rec.material_stock,
        'shortfall',     v_rec.total_consumed - v_rec.material_stock,
        'unit',          v_rec.material_unit
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_missing) > 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL = v_missing::text;
  END IF;

  -- Create lot UPFRONT for finished product if shelf-life set. Lot quantity
  -- mirrors actual_yield (what physically exists in the bakery), not the plan.
  IF v_product_shelf IS NOT NULL THEN
    v_lot_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':lot')::uuid
    END;
    SELECT (create_stock_lot_v1(
      p_product_id      := p_product_id,
      p_quantity        := v_actual_yield,
      p_unit            := v_product_unit,
      p_location_id     := NULL,
      p_expires_at      := NULL,
      p_batch_number    := p_batch_number,
      p_idempotency_key := v_lot_idem_key,
      p_metadata        := '{}'::JSONB
    )->>'lot_id')::uuid INTO v_lot_id;
  END IF;

  v_production_number := 'PROD-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('production_records_seq')::text, 4, '0');

  SELECT id INTO v_recipe_version_id
    FROM recipe_versions
   WHERE product_id = p_product_id
   ORDER BY version_number DESC
   LIMIT 1;

  INSERT INTO production_records (
    production_number, product_id, quantity_produced, quantity_waste,
    production_date, section_id, staff_id, batch_number, notes,
    idempotency_key, materials_consumed, stock_updated, je_posted,
    recipe_version_id, materials_breakdown,
    expected_yield_qty, actual_yield_qty, yield_variance_reason
  ) VALUES (
    v_production_number, p_product_id, p_quantity_produced, p_quantity_waste,
    now(), p_section_id, v_profile, p_batch_number, p_notes,
    p_idempotency_key, FALSE, FALSE, FALSE,
    v_recipe_version_id, v_breakdown,
    v_expected_yield, v_actual_yield, v_yield_reason
  ) RETURNING id INTO v_production_id;

  -- production_in for finished product. D5 : quantity = actual_yield (not produced).
  -- The tr_20_je_emit trigger reads ABS(NEW.quantity) so Dr Inventory finished-
  -- goods JE value reflects actual yield automatically.
  v_in_result := record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'production_in',
    p_quantity        := v_actual_yield,
    p_reason          := 'Production batch ' || v_production_number,
    p_unit_cost       := v_product_cost,
    p_supplier_id     := NULL,
    p_idempotency_key := p_idempotency_key,
    p_unit            := v_product_unit,
    p_from_section_id := NULL,
    p_to_section_id   := p_section_id,
    p_metadata        := jsonb_build_object(
                          'production_id',       v_production_id,
                          'production_number',   v_production_number,
                          'batch_number',        p_batch_number,
                          'expected_yield_qty',  v_expected_yield,
                          'actual_yield_qty',    v_actual_yield
                         ),
    p_lot_id          := v_lot_id
  );
  v_movement_id := (v_in_result->>'movement_id')::uuid;
  v_movement_ids := array_append(v_movement_ids, v_movement_id);
  v_movements_count := v_movements_count + 1;

  -- production_out movements per aggregated consumption row. Based on planned
  -- produced + waste (legacy semantic).
  FOR v_rec IN SELECT * FROM _leaf_consumption ORDER BY material_name LOOP
    v_out_result := record_stock_movement_v1(
      p_product_id      := v_rec.material_id,
      p_movement_type   := 'production_out',
      p_quantity        := -v_rec.total_consumed,
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
                            'cascade',           p_recurse_subrecipes
                           ),
      p_lot_id          := NULL
    );
    v_movement_id := (v_out_result->>'movement_id')::uuid;
    v_movement_ids := array_append(v_movement_ids, v_movement_id);
    v_movements_count := v_movements_count + 1;
  END LOOP;

  UPDATE production_records
    SET materials_consumed = TRUE,
        stock_updated      = TRUE,
        updated_at         = now()
    WHERE id = v_production_id;

  SELECT COUNT(*) INTO v_je_count
    FROM journal_entries
    WHERE reference_type = 'stock_movement'
      AND reference_id = ANY(v_movement_ids);

  IF v_je_count > 0 THEN
    UPDATE production_records SET je_posted = TRUE, updated_at = now()
      WHERE id = v_production_id;
  END IF;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'production.create', 'production_records', v_production_id,
    jsonb_build_object(
      'production_number',     v_production_number,
      'product_id',            p_product_id,
      'quantity_produced',     p_quantity_produced,
      'quantity_waste',        p_quantity_waste,
      'section_id',            p_section_id,
      'batch_number',          p_batch_number,
      'movements_count',       v_movements_count,
      'je_count',              v_je_count,
      'lot_id',                v_lot_id,
      'idempotency_key',       p_idempotency_key,
      'recurse_subrecipes',    p_recurse_subrecipes,
      'recipe_version_id',     v_recipe_version_id,
      'depth_reached',         v_max_depth_reached,
      'expected_yield_qty',    v_expected_yield,
      'actual_yield_qty',      v_actual_yield,
      'yield_variance_reason', v_yield_reason
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'production_id',         v_production_id,
    'production_number',     v_production_number,
    'lot_id',                v_lot_id,
    'movements_count',       v_movements_count,
    'je_count',              v_je_count,
    'idempotent_replay',     false,
    'recipe_version_id',     v_recipe_version_id,
    'depth_reached',         v_max_depth_reached,
    'materials_breakdown',   v_breakdown,
    'expected_yield_qty',    v_expected_yield,
    'actual_yield_qty',      v_actual_yield,
    'yield_variance_reason', v_yield_reason
  );
END $$;

GRANT EXECUTE ON FUNCTION record_production_v1(
  UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID, BOOLEAN, DECIMAL, DECIMAL, TEXT
) TO authenticated;
REVOKE EXECUTE ON FUNCTION record_production_v1(
  UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID, BOOLEAN, DECIMAL, DECIMAL, TEXT
) FROM anon;

COMMENT ON FUNCTION record_production_v1(
  UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID, BOOLEAN, DECIMAL, DECIMAL, TEXT
) IS
  'Session 15 — Phase 2.A. Yield-aware atomic production RPC. Adds optional '
  'p_expected_yield_qty, p_actual_yield_qty, p_yield_variance_reason (all '
  'DEFAULT NULL ; fallback to p_quantity_produced for both yield params). '
  'JE Dr Inventory finished-goods uses actual_yield via stock_movements.quantity '
  '(D5). Materials consumption unchanged (planned + waste). Backward-compatible '
  'with pre-Session-15 callers. Gated by inventory.production.create (MANAGER+).';
