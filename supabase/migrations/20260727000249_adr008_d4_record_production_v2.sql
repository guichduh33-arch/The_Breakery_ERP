-- 20260727000249_adr008_d4_record_production_v2.sql
--
-- ADR-008 D4 — Production à stock insuffisant : blocage par défaut.
--
-- Étape 2/3 : `record_production_v2` remplace `record_production_v1`.
--
-- Corps repris du LIVE (`pg_get_functiondef`, cf. constat ADR-008 « les fichiers
-- de migration ne reflètent plus les fonctions en production »). Deux seules
-- différences fonctionnelles :
--
--   1. La v1 lisait `business_config.allow_negative_stock` (défaut code `true`,
--      défaut colonne `true`) : sans configuration explicite, TOUTE production
--      passait silencieusement en stock négatif. La v2 ne lit plus ce réglage —
--      il ne gouverne plus que la vente (POS / B2B). La production BLOQUE.
--   2. Nouveau `p_force_negative` : seule échappatoire, gatée par la permission
--      `inventory.production.force_negative` (ADMIN+), tracée dans `audit_logs`
--      avec la liste des manquants, et remontée au client (`forced_negative`,
--      `shortages`) pour l'avertissement UI.

CREATE OR REPLACE FUNCTION public.record_production_v2(
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
  v_total_consumed    DECIMAL(14,2) := 0;
  v_allow_negative    BOOLEAN;
  v_deduct_stock      BOOLEAN;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- ADR-008 D4 : le forçage du stock négatif est un acte volontaire, gaté par
  -- sa propre permission. Le réglage global de vente n'entre plus en jeu ici.
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

COMMENT ON FUNCTION public.record_production_v2(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean)
  IS 'ADR-008 D4 : production atomique. Bloque en stock insuffisant ; p_force_negative (permission inventory.production.force_negative) est la seule échappatoire. Ne lit plus business_config.allow_negative_stock (réglage de vente).';

-- Versioning monotone : la v1 disparaît dans la même migration. Son seul appelant
-- serveur est `record_batch_production_v1`, lui-même remplacé à l'étape 3/3.
DROP FUNCTION IF EXISTS public.record_production_v1(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text);

REVOKE EXECUTE ON FUNCTION public.record_production_v2(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_production_v2(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.record_production_v2(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
