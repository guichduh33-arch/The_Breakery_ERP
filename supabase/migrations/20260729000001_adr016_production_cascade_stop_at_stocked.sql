-- ADR-016 — Une production consomme un semi-fini stocké depuis son stock.
--
-- La cascade de production s'arrête au premier intermédiaire suivi en stock
-- (`products.track_inventory = true`) et le consomme depuis son stock, au lieu
-- de descendre jusqu'aux matières premières. Seuls les intermédiaires NON suivis
-- en stock restent dépliés. C'est la règle que `_resolve_recipe_consumption_v1`
-- applique déjà côté vente ; la production s'y aligne.
--
-- Corrige par construction l'erreur d'unité d'un facteur mille d'ADR-008 D1 :
-- on n'atteint plus le niveau où l'unité de la ligne parent était perdue.
--
-- Corps construits sur `pg_get_functiondef` (les fichiers de migration d'origine
-- ont divergé du live — constat ADR-008).
--
-- `record_batch_production_v3` (impl interne) et `_v4` (wrapper de date) sont
-- fusionnées en une seule `_v5` : le wrapper n'existait que pour patcher
-- `production_date` après coup.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. record_production_v2 → v3
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_production_v3(
  p_product_id            uuid,
  p_quantity_produced     numeric,
  p_section_id            uuid,
  p_batch_number          text    DEFAULT NULL::text,
  p_quantity_waste        numeric DEFAULT 0,
  p_notes                 text    DEFAULT NULL::text,
  p_idempotency_key       uuid    DEFAULT NULL::uuid,
  p_recurse_subrecipes    boolean DEFAULT true,
  p_expected_yield_qty    numeric DEFAULT NULL::numeric,
  p_actual_yield_qty      numeric DEFAULT NULL::numeric,
  p_yield_variance_reason text    DEFAULT NULL::text,
  p_force_negative        boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile           UUID;
  v_product_unit      TEXT;
  v_product_cost      DECIMAL(14,2);
  v_product_shelf     INT;
  v_product_type      TEXT;
  v_production_id     UUID;
  v_production_number TEXT;
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
  v_total_consumed    DECIMAL(14,2) := 0;
  v_allow_negative    BOOLEAN;
  v_deduct_stock      BOOLEAN;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_allow_negative := COALESCE(p_force_negative, false);
  IF v_allow_negative AND NOT has_permission(v_uid, 'inventory.production.force_negative') THEN
    RAISE EXCEPTION 'force_negative_forbidden' USING ERRCODE='P0003',
      HINT = 'inventory.production.force_negative is required to produce below stock';
  END IF;

  IF p_section_id IS NULL THEN
    RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001',
      HINT = 'production movements require a section (chk_stock_movements_section_required)';
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

  v_expected_yield := COALESCE(p_expected_yield_qty, p_quantity_produced);
  v_actual_yield   := COALESCE(p_actual_yield_qty,   p_quantity_produced);
  v_yield_reason   := p_yield_variance_reason;

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

  SELECT unit, cost_price, default_shelf_life_hours, product_type, COALESCE(deduct_stock, true)
    INTO v_product_unit, v_product_cost, v_product_shelf, v_product_type, v_deduct_stock
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
    is_intermediate BOOLEAN,
    is_stocked     BOOLEAN
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
      ) AS is_intermediate,
      COALESCE(m.track_inventory, TRUE) AS is_stocked
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
      ),
      COALESCE(m.track_inventory, TRUE)
    FROM flatten f
    JOIN recipes r ON r.product_id = f.material_id
    JOIN products m ON m.id = r.material_id
    WHERE p_recurse_subrecipes = TRUE
      AND f.is_intermediate = TRUE
      AND f.is_stocked = FALSE
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
      AND f.depth < v_max_depth_const
      AND NOT (r.material_id = ANY(f.sub_path))
  )
  INSERT INTO _bom_flatten
  SELECT material_id, material_name, material_unit, material_cost, material_stock,
         recipe_unit, qty_in_recipe_unit, depth, sub_path, is_intermediate, is_stocked
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
        'consumed',       (NOT is_intermediate) OR is_stocked,
        'is_stocked',     is_stocked,
        'qty_per_unit',   CASE WHEN p_quantity_produced > 0
                              THEN (CASE WHEN recipe_unit = material_unit
                                         THEN qty_in_recipe_unit
                                         ELSE convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit)
                                    END / v_total_factor)
                              ELSE 0 END,
        'total_consumed', CASE WHEN recipe_unit = material_unit
                              THEN qty_in_recipe_unit
                              ELSE convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit)
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
        ELSE convert_quantity(f.qty_in_recipe_unit, f.recipe_unit, f.material_unit)
      END
    )::DECIMAL(14,3)
  FROM _bom_flatten f
  WHERE
    CASE
      WHEN p_recurse_subrecipes THEN (f.is_intermediate = FALSE OR f.is_stocked = TRUE)
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

  IF v_deduct_stock AND NOT v_allow_negative AND jsonb_array_length(v_missing) > 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL = v_missing::text;
  END IF;

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

  SELECT COALESCE(SUM(total_consumed * material_cost), 0)::DECIMAL(14,2)
    INTO v_total_consumed FROM _leaf_consumption;

  v_in_result := record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'production_in',
    p_quantity        := v_actual_yield,
    p_reason          := 'Production batch ' || v_production_number,
    p_unit_cost       := CASE WHEN v_actual_yield > 0
                              THEN round(v_total_consumed / v_actual_yield, 2)
                              ELSE NULL END,
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

  IF v_deduct_stock THEN
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
        p_lot_id          := NULL,
        p_allow_negative  := v_allow_negative
      );
      v_movement_id := (v_out_result->>'movement_id')::uuid;
      v_movement_ids := array_append(v_movement_ids, v_movement_id);
      v_movements_count := v_movements_count + 1;
    END LOOP;
  END IF;

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

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
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
      'cascade_rule',          'adr016_stop_at_stocked',
      'recipe_version_id',     v_recipe_version_id,
      'depth_reached',         v_max_depth_reached,
      'expected_yield_qty',    v_expected_yield,
      'actual_yield_qty',      v_actual_yield,
      'yield_variance_reason', v_yield_reason,
      'force_negative',        v_allow_negative,
      'shortages',             CASE WHEN v_allow_negative THEN v_missing ELSE '[]'::JSONB END
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
    'yield_variance_reason', v_yield_reason,
    'forced_negative',       v_allow_negative,
    'shortages',             CASE WHEN v_allow_negative THEN v_missing ELSE '[]'::JSONB END
  );
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. record_batch_production_v3 + v4 → v5 (fusion impl + wrapper de date)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_batch_production_v5(p_batch jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile          UUID;
  v_batch_id         UUID;
  v_batch_number     TEXT;
  v_batch_notes      TEXT;
  v_batch_idem_key   UUID;
  v_existing_batch   production_batches%ROWTYPE;
  v_item             jsonb;
  v_item_idx         INT;
  v_product_id       UUID;
  v_quantity         NUMERIC;
  v_waste            NUMERIC;
  v_expected_yield   NUMERIC;
  v_actual_yield     NUMERIC;
  v_variance_reason  TEXT;
  v_item_idem_key    UUID;
  v_section_id       UUID;
  v_records          JSONB := '[]'::JSONB;
  v_rec_result       JSONB;
  v_production_id    UUID;
  v_shortages        JSONB := '[]'::JSONB;
  v_agg              RECORD;
  v_allow_negative   BOOLEAN;
  v_production_date  TIMESTAMPTZ;
  v_patched          INT := 0;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_batch IS NULL OR jsonb_typeof(p_batch) <> 'object' THEN
    RAISE EXCEPTION 'invalid_batch_envelope' USING ERRCODE='P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_must_be_non_empty_array' USING ERRCODE='P0001';
  END IF;

  IF (p_batch ? 'production_date')
     AND NULLIF(p_batch->>'production_date', '') IS NOT NULL THEN
    BEGIN
      v_production_date := (p_batch->>'production_date')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_production_date' USING ERRCODE='P0001',
        HINT = 'production_date must be an ISO-8601 timestamp';
    END;
  END IF;

  v_allow_negative := FALSE;
  IF p_batch ? 'force_negative' THEN
    IF jsonb_typeof(p_batch->'force_negative') <> 'boolean' THEN
      RAISE EXCEPTION 'invalid_force_negative' USING ERRCODE='P0001',
        HINT = 'force_negative must be a JSON boolean';
    END IF;
    v_allow_negative := (p_batch->>'force_negative')::boolean;
  END IF;
  IF v_allow_negative AND NOT has_permission(v_uid, 'inventory.production.force_negative') THEN
    RAISE EXCEPTION 'force_negative_forbidden' USING ERRCODE='P0003',
      HINT = 'inventory.production.force_negative is required to produce below stock';
  END IF;

  v_batch_notes := p_batch->>'notes';
  IF (p_batch->>'section_id') IS NOT NULL AND length(p_batch->>'section_id') > 0 THEN
    v_section_id := (p_batch->>'section_id')::uuid;
  END IF;
  IF v_section_id IS NULL THEN
    RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001',
      HINT = 'production movements require a section (chk_stock_movements_section_required)';
  END IF;

  IF (p_batch->>'idempotency_key') IS NOT NULL AND length(p_batch->>'idempotency_key') > 0 THEN
    v_batch_idem_key := (p_batch->>'idempotency_key')::uuid;
  END IF;

  IF v_batch_idem_key IS NOT NULL THEN
    SELECT * INTO v_existing_batch FROM production_batches
      WHERE idempotency_key = v_batch_idem_key LIMIT 1;
    IF v_existing_batch.id IS NOT NULL THEN
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'production_id',     pr.id,
          'production_number', pr.production_number,
          'product_id',        pr.product_id,
          'quantity_produced', pr.quantity_produced,
          'quantity_waste',    pr.quantity_waste
        )
      ORDER BY pr.created_at), '[]'::JSONB)
        INTO v_records
        FROM production_records pr
        WHERE pr.batch_id = v_existing_batch.id;
      RETURN jsonb_build_object(
        'batch_id',           v_existing_batch.id,
        'batch_number',       v_existing_batch.batch_number,
        'status',             v_existing_batch.status,
        'production_records', v_records,
        'idempotent_replay',  TRUE
      );
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  DROP TABLE IF EXISTS pg_temp._batch_items;
  CREATE TEMP TABLE _batch_items (
    item_idx          INT     PRIMARY KEY,
    product_id        UUID    NOT NULL,
    quantity_produced NUMERIC NOT NULL,
    quantity_waste    NUMERIC NOT NULL,
    expected_yield    NUMERIC,
    actual_yield      NUMERIC,
    variance_reason   TEXT,
    item_idem_key     UUID
  ) ON COMMIT DROP;

  v_item_idx := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_item_idx := v_item_idx + 1;

    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'invalid_item_shape' USING ERRCODE='P0001',
        DETAIL = format('Item #%s is not a JSON object', v_item_idx);
    END IF;

    IF (v_item->>'product_id') IS NULL OR length(v_item->>'product_id') = 0 THEN
      RAISE EXCEPTION 'item_missing_product_id' USING ERRCODE='P0001',
        DETAIL = format('Item #%s', v_item_idx);
    END IF;

    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := COALESCE((v_item->>'quantity_produced')::numeric, 0);
    v_waste      := COALESCE((v_item->>'quantity_waste')::numeric, 0);

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001',
        DETAIL = format('Item #%s product=%s', v_item_idx, v_product_id);
    END IF;
    IF v_waste < 0 THEN
      RAISE EXCEPTION 'waste_must_be_non_negative' USING ERRCODE='P0001',
        DETAIL = format('Item #%s product=%s', v_item_idx, v_product_id);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM recipes
        WHERE product_id = v_product_id
          AND is_active = TRUE
          AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002',
        DETAIL = format('Item #%s product=%s has no active recipe', v_item_idx, v_product_id);
    END IF;

    v_expected_yield  := NULLIF(v_item->>'expected_yield_qty', '')::numeric;
    v_actual_yield    := NULLIF(v_item->>'actual_yield_qty',   '')::numeric;
    v_variance_reason := NULLIF(v_item->>'yield_variance_reason', '');
    v_item_idem_key   := NULLIF(v_item->>'idempotency_key',     '')::uuid;

    INSERT INTO _batch_items VALUES (
      v_item_idx, v_product_id, v_quantity, v_waste,
      v_expected_yield, v_actual_yield, v_variance_reason, v_item_idem_key
    );
  END LOOP;

  WITH RECURSIVE
    items AS (
      SELECT bi.product_id, (bi.quantity_produced + bi.quantity_waste) AS factor
        FROM _batch_items bi
        JOIN products p ON p.id = bi.product_id
        WHERE COALESCE(p.deduct_stock, TRUE)
    ),
    flatten AS (
      SELECT
        i.product_id AS root_product_id,
        r.material_id,
        m.name AS material_name,
        m.unit AS material_unit,
        m.current_stock AS material_stock,
        r.unit AS recipe_unit,
        (r.quantity * i.factor)::DECIMAL(20,6) AS qty_in_recipe_unit,
        1 AS depth,
        ARRAY[i.product_id]::UUID[] AS sub_path,
        EXISTS (
          SELECT 1 FROM recipes r2
            WHERE r2.product_id = r.material_id
              AND r2.is_active = TRUE AND r2.deleted_at IS NULL
        ) AS is_intermediate,
        COALESCE(m.track_inventory, TRUE) AS is_stocked
      FROM items i
      JOIN recipes r ON r.product_id = i.product_id
      JOIN products m ON m.id = r.material_id
      WHERE r.is_active = TRUE AND r.deleted_at IS NULL
      UNION ALL
      SELECT
        f.root_product_id,
        r.material_id,
        m.name,
        m.unit,
        m.current_stock,
        r.unit,
        (f.qty_in_recipe_unit * r.quantity)::DECIMAL(20,6),
        f.depth + 1,
        f.sub_path || f.material_id,
        EXISTS (
          SELECT 1 FROM recipes r2
            WHERE r2.product_id = r.material_id
              AND r2.is_active = TRUE AND r2.deleted_at IS NULL
        ),
        COALESCE(m.track_inventory, TRUE)
      FROM flatten f
      JOIN recipes r ON r.product_id = f.material_id
      JOIN products m ON m.id = r.material_id
      WHERE f.is_intermediate = TRUE
        AND f.is_stocked = FALSE
        AND r.is_active = TRUE AND r.deleted_at IS NULL
        AND f.depth < 5
        AND NOT (r.material_id = ANY(f.sub_path))
    ),
    leaves AS (
      SELECT
        material_id,
        MAX(material_name)  AS material_name,
        MAX(material_unit)  AS material_unit,
        MAX(material_stock) AS material_stock,
        SUM(
          CASE WHEN recipe_unit = material_unit
               THEN qty_in_recipe_unit
               ELSE convert_quantity(qty_in_recipe_unit, recipe_unit, material_unit)
          END
        )::DECIMAL(14,3) AS total_required
      FROM flatten
      WHERE is_intermediate = FALSE OR is_stocked = TRUE
      GROUP BY material_id
    )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'material_id',   material_id,
      'material_name', material_name,
      'required',      total_required,
      'available',     material_stock,
      'shortfall',     total_required - material_stock,
      'unit',          material_unit
    ) ORDER BY material_name), '[]'::JSONB)
    INTO v_shortages
    FROM leaves
    WHERE material_stock < total_required;

  IF NOT v_allow_negative AND jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL = v_shortages::text;
  END IF;

  v_batch_number := 'BATCH-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('production_batches_seq')::text, 4, '0');

  INSERT INTO production_batches (
    batch_number, started_at, staff_id, status, notes, idempotency_key
  ) VALUES (
    v_batch_number, now(), v_profile, 'open', v_batch_notes, v_batch_idem_key
  ) RETURNING id INTO v_batch_id;

  FOR v_agg IN SELECT * FROM _batch_items ORDER BY item_idx LOOP
    DROP TABLE IF EXISTS pg_temp._bom_flatten;
    DROP TABLE IF EXISTS pg_temp._leaf_consumption;

    v_rec_result := record_production_v3(
      p_product_id            := v_agg.product_id,
      p_quantity_produced     := v_agg.quantity_produced,
      p_section_id            := v_section_id,
      p_batch_number          := v_batch_number,
      p_quantity_waste        := v_agg.quantity_waste,
      p_notes                 := v_batch_notes,
      p_idempotency_key       := v_agg.item_idem_key,
      p_recurse_subrecipes    := TRUE,
      p_expected_yield_qty    := v_agg.expected_yield,
      p_actual_yield_qty      := v_agg.actual_yield,
      p_yield_variance_reason := v_agg.variance_reason,
      p_force_negative        := v_allow_negative
    );
    v_production_id := (v_rec_result->>'production_id')::uuid;

    UPDATE production_records
       SET batch_id   = v_batch_id,
           updated_at = now()
     WHERE id = v_production_id;

    v_records := v_records || jsonb_build_array(jsonb_build_object(
      'production_id',     v_production_id,
      'production_number', v_rec_result->>'production_number',
      'product_id',        v_agg.product_id,
      'quantity_produced', v_agg.quantity_produced,
      'quantity_waste',    v_agg.quantity_waste,
      'movements_count',   v_rec_result->'movements_count',
      'lot_id',            v_rec_result->'lot_id'
    ));
  END LOOP;

  UPDATE production_batches
     SET status       = 'completed',
         completed_at = now(),
         updated_at   = now()
   WHERE id = v_batch_id;

  IF v_production_date IS NOT NULL THEN
    UPDATE production_records
       SET production_date = v_production_date,
           updated_at      = now()
     WHERE batch_id = v_batch_id;
    GET DIAGNOSTICS v_patched = ROW_COUNT;
  END IF;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'production.batch.create', 'production_batches', v_batch_id,
    jsonb_build_object(
      'batch_number',       v_batch_number,
      'items_count',        jsonb_array_length(p_items),
      'section_id',         v_section_id,
      'idempotency_key',    v_batch_idem_key,
      'production_records', v_records,
      'force_negative',     v_allow_negative,
      'cascade_rule',       'adr016_stop_at_stocked',
      'production_date',    v_production_date,
      'shortages',          CASE WHEN v_allow_negative THEN v_shortages ELSE '[]'::JSONB END
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'batch_id',                 v_batch_id,
    'batch_number',             v_batch_number,
    'status',                   'completed',
    'production_records',       v_records,
    'idempotent_replay',        FALSE,
    'forced_negative',          v_allow_negative,
    'production_date',          v_production_date,
    'production_date_patched',  v_patched,
    'shortages',                CASE WHEN v_allow_negative THEN v_shortages ELSE '[]'::JSONB END
  );
END $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DROP des versions remplacées (même migration — versioning monotone)
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.record_batch_production_v4(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.record_batch_production_v3(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.record_production_v2(
  uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Grants — paire REVOKE complète (anon hérite EXECUTE via PUBLIC)
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.record_production_v3(
  uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_production_v3(
  uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean
) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_production_v3(
  uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.record_batch_production_v5(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_batch_production_v5(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_batch_production_v5(jsonb, jsonb) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.record_production_v3(
  uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean
) IS 'ADR-016: la cascade s''arrete au premier intermediaire suivi en stock et le consomme depuis son stock.';
COMMENT ON FUNCTION public.record_batch_production_v5(jsonb, jsonb)
  IS 'ADR-016: saisie de production par lot. Fusionne l''ancienne impl interne et son wrapper de date.';
