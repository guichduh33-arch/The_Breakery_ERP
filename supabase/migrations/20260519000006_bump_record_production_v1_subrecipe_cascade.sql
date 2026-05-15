-- 20260519000006_bump_record_production_v1_subrecipe_cascade.sql
-- Session 15 / Phase 1.A — record_production_v1 with sub-recipe cascade.
--
-- Decision D3 : when a material_id is itself a recipe-built product, and
-- p_recurse_subrecipes=TRUE (default), recursively flatten the BoM to leaves
-- and consume the leaves directly (option A1). No nested production_records
-- are created. The breakdown (intermediates + leaves) is captured in
-- production_records.materials_breakdown JSONB.
--
-- New optional parameter `p_recurse_subrecipes BOOLEAN DEFAULT TRUE` appended
-- AFTER p_idempotency_key. Default TRUE preserves cascade as expected by new
-- callers ; passing FALSE replicates the pre-Session-15 flat-BoM behaviour
-- (consume direct materials regardless of whether they're recipe-built).
--
-- Defensively also adds production_records.materials_breakdown column AND
-- production_records.recipe_version_id (idempotent via IF NOT EXISTS).
--
-- Implementation :
--   - Recursive CTE `flatten` walks the BoM tree, multiplying quantity along
--     each path, converting units to the material's storage unit.
--   - When p_recurse_subrecipes=TRUE : the recursion expands every
--     intermediate ; the final consumption set is only the leaves.
--   - When p_recurse_subrecipes=FALSE : the recursion doesn't fire ; we
--     consume the seed materials directly (intermediates treated as
--     leaves for the purpose of stock movement).
--   - Stock validation aggregates per-material across all paths.
--   - Depth-protected (max_depth = 5).
--   - Cycle-protected (path tracking + anti-cycle trigger upstream).
--   - Idempotency replay unchanged.

ALTER TABLE production_records
  ADD COLUMN IF NOT EXISTS materials_breakdown JSONB;

ALTER TABLE production_records
  ADD COLUMN IF NOT EXISTS recipe_version_id UUID
    REFERENCES recipe_versions(id) ON DELETE SET NULL;

-- Drop the previous overload (7-arg signature) so the new 8-arg signature
-- becomes the unambiguous resolution for callers. Per CLAUDE.md RPC
-- versioning rule, signature changes within a `_vN` must drop the old.
DROP FUNCTION IF EXISTS record_production_v1(UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID);

CREATE OR REPLACE FUNCTION record_production_v1(
  p_product_id          UUID,
  p_quantity_produced   DECIMAL(10,3),
  p_section_id          UUID,
  p_batch_number        TEXT          DEFAULT NULL,
  p_quantity_waste      DECIMAL(10,3) DEFAULT 0,
  p_notes               TEXT          DEFAULT NULL,
  p_idempotency_key     UUID          DEFAULT NULL,
  p_recurse_subrecipes  BOOLEAN       DEFAULT TRUE
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

  v_total_factor := p_quantity_produced + p_quantity_waste;

  -- ──────────────────────────────────────────────────────────────────────────
  -- Build flatten temp table : one row per (material_id, depth, path).
  -- When p_recurse_subrecipes=FALSE, only depth=1 rows exist ; we treat all
  -- of them as consumption leaves regardless of is_intermediate.
  -- When TRUE, we recurse and the final consumption set is only is_intermediate=FALSE.
  -- ──────────────────────────────────────────────────────────────────────────
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

  -- Build informational breakdown (all steps : leaves + intermediates).
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

  -- Aggregate consumption per material. When recurse=TRUE, consume only leaves.
  -- When recurse=FALSE, consume the depth=1 rows as-is (all of them).
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
      WHEN p_recurse_subrecipes THEN f.is_intermediate = FALSE  -- only true leaves
      ELSE f.depth = 1                                            -- only direct materials
    END
  GROUP BY f.material_id;

  -- Stock validation.
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

  -- Create lot UPFRONT for finished product if shelf-life set.
  IF v_product_shelf IS NOT NULL THEN
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

  -- Generate production_number.
  v_production_number := 'PROD-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('production_records_seq')::text, 4, '0');

  -- Resolve latest recipe_version_id.
  SELECT id INTO v_recipe_version_id
    FROM recipe_versions
   WHERE product_id = p_product_id
   ORDER BY version_number DESC
   LIMIT 1;

  INSERT INTO production_records (
    production_number, product_id, quantity_produced, quantity_waste,
    production_date, section_id, staff_id, batch_number, notes,
    idempotency_key, materials_consumed, stock_updated, je_posted,
    recipe_version_id, materials_breakdown
  ) VALUES (
    v_production_number, p_product_id, p_quantity_produced, p_quantity_waste,
    now(), p_section_id, v_profile, p_batch_number, p_notes,
    p_idempotency_key, FALSE, FALSE, FALSE,
    v_recipe_version_id, v_breakdown
  ) RETURNING id INTO v_production_id;

  -- production_in for finished product.
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

  -- production_out movements per aggregated consumption row.
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
      'production_number', v_production_number,
      'product_id',        p_product_id,
      'quantity_produced', p_quantity_produced,
      'quantity_waste',    p_quantity_waste,
      'section_id',        p_section_id,
      'batch_number',      p_batch_number,
      'movements_count',   v_movements_count,
      'je_count',          v_je_count,
      'lot_id',            v_lot_id,
      'idempotency_key',   p_idempotency_key,
      'recurse_subrecipes', p_recurse_subrecipes,
      'recipe_version_id', v_recipe_version_id,
      'depth_reached',     v_max_depth_reached
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'production_id',     v_production_id,
    'production_number', v_production_number,
    'lot_id',            v_lot_id,
    'movements_count',   v_movements_count,
    'je_count',          v_je_count,
    'idempotent_replay', false,
    'recipe_version_id', v_recipe_version_id,
    'depth_reached',     v_max_depth_reached,
    'materials_breakdown', v_breakdown
  );
END $$;

GRANT EXECUTE ON FUNCTION record_production_v1(UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION record_production_v1(UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID, BOOLEAN) FROM anon;

COMMENT ON FUNCTION record_production_v1(UUID, DECIMAL, UUID, TEXT, DECIMAL, TEXT, UUID, BOOLEAN) IS
  'Session 15 — Phase 1.A. Atomic production batch RPC with sub-recipe cascade. '
  'When p_recurse_subrecipes=TRUE (default), recursively flattens recipe tree to '
  'leaves (max depth 5), validates aggregated stock, consumes leaves only. '
  'When FALSE, behaves as the original flat-BoM v1 (consumes direct materials). '
  'Captures materials_breakdown JSONB and recipe_version_id snapshot. '
  'Idempotent via p_idempotency_key. Gated by inventory.production.create (MANAGER+).';
