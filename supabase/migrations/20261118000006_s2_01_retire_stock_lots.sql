-- S2-01, S2-02 (volet base) et S2-08 — retrait de la mécanique de lots et de
-- péremption (ADR-004), du rapport de rotation des périssables et du réglage de
-- seuil d'écart de rendement.
--
-- ADR-004 décide : ni péremption, ni expiration, ni consommation FIFO, et
-- « conserver `stock_lots` dormante (pas de DROP) ». Cette migration applique la
-- décision à la lettre : la TABLE reste, avec ses lignes, en lecture seule ; plus
-- aucune fonction ne la lit pour décider d'un mouvement, ni ne l'écrit.
--
-- Corps repris du corps LIVE (`pg_get_functiondef`) sur le dev V3 le 2026-11-18.
--
-- Remplacements EN PLACE (même nom, même signature), légitimes parce que ces
-- deux fonctions ne sont pas des contrats publiés : aucun grant à
-- `authenticated`, aucun appel applicatif, seulement des appelants SQL.
-- Précédent du dépôt : `_record_sale_stock_v1`, remplacé en place par
-- `20260710000107`.
--   * `record_stock_movement_v2` (grants postgres, service_role) : le bloc qui
--     choisissait un lot par date de péremption et le décrémentait est retiré.
--     L'argument `p_lot_id` reste dans la signature (dix appelants) mais un lot
--     fourni est désormais refusé : `lot_tracking_retired`.
--   * `stock_private.record_production_v10` (grant postgres seul, appelée par le
--     seul enveloppant `record_production_v12`) : plus de création de lot à la
--     fournée. Le motif d'écart reste accepté et conservé : la colonne
--     d'historique `production_records.yield_variance_reason` garde ses lignes,
--     et le back-office ne propose plus de le saisir (S2-02).
--
-- Versions neuves (contrats publiés, `authenticated`) :
--   * `receive_purchase_order_v7` remplace la v6 : plus de lot à la réception.
--   * `revert_production_v5` remplace la v4 : plus de remise à zéro du lot.
--   * `get_product_dashboard_v9` remplace la v8 : plus de section « lots ».
--
-- Retirés : `create_stock_lot_v1`, `_kitchen_stock_lot_v1`, `_resolve_fifo_lot`,
-- `get_expiring_lots_v1`, `mark_expired_lots_hourly` (et sa tâche planifiée si
-- elle existe), `get_perishable_turnover_v1` (S2-08), et la colonne
-- `business_config.production_yield_variance_threshold_pct`, que seul l'écran
-- retiré lisait (S2-02).
--
-- Conservés : la table `stock_lots`, la colonne `stock_movements.lot_id`
-- (historique), `products.default_shelf_life_hours` (catalogue, import/export),
-- et `get_wastage_report_v4`, qui affiche le lot d'une perte passée.
--
-- Fichier > 12 KB : appliqué en plusieurs appels `apply_migration`, dans l'ordre
-- des sections ; ce fichier reste l'artefact de référence.

-- ═══ 1. Primitive du ledger : plus aucune lecture de lot ═══════════════════

CREATE OR REPLACE FUNCTION public.record_stock_movement_v2(p_product_id uuid, p_movement_type movement_type, p_quantity numeric, p_reason text, p_unit_cost numeric DEFAULT NULL::numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid, p_unit text DEFAULT NULL::text, p_from_section_id uuid DEFAULT NULL::uuid, p_to_section_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb, p_lot_id uuid DEFAULT NULL::uuid, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid(); v_profile UUID; v_current NUMERIC; v_new NUMERIC;
  v_mvt_id UUID; v_unit TEXT; v_meta JSONB := COALESCE(p_metadata, '{}'::JSONB);
  v_ref_type TEXT; v_ref_id UUID; v_quantity NUMERIC;
BEGIN
  -- ADR-004 : aucun mouvement ne se rattache plus à un lot.
  IF p_lot_id IS NOT NULL THEN
    RAISE EXCEPTION 'lot_tracking_retired' USING ERRCODE = 'P0001',
      HINT = 'ADR-004: stock is tracked as a global quantity per product; lots are retired';
  END IF;

  -- Une seule quantification effective avant gardes, ledger et cache.
  v_quantity := round(p_quantity, 9);
  IF p_quantity <> 0 AND v_quantity = 0 THEN
    RAISE EXCEPTION 'quantity_below_stock_precision' USING ERRCODE = 'P0001';
  END IF;
  p_quantity := v_quantity;
  IF p_movement_type IN ('sale', 'sale_void') THEN
    RAISE EXCEPTION 'record_stock_movement_v2 cannot be called with movement_type=%', p_movement_type;
  END IF;
  IF p_quantity = 0 THEN RAISE EXCEPTION 'quantity_must_be_nonzero'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  -- La référence voyage dans les métadonnées et reste posée dès l insertion.
  v_ref_type := COALESCE(NULLIF(TRIM(COALESCE(v_meta->>'reference_type', '')), ''), 'admin_action');
  BEGIN
    v_ref_id := NULLIF(TRIM(COALESCE(v_meta->>'reference_id', '')), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_reference_id: %', v_meta->>'reference_id' USING ERRCODE = 'P0002';
  END;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM stock_movements WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_new FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object('movement_id', v_mvt_id, 'product_id', p_product_id,
        'new_current_stock', v_new, 'idempotent_replay', true);
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    IF v_uid IS NULL AND session_user = 'postgres' THEN
      v_profile := '00000000-0000-0000-0000-000000000999';  -- SYSTEM (cron)
    ELSE RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
  END IF;

  SELECT current_stock, unit INTO v_current, v_unit FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;

  v_unit := COALESCE(p_unit, v_unit, 'pcs');
  v_new := v_current + p_quantity;
  IF v_new < 0 AND NOT p_allow_negative THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002'; END IF;

  -- ADR-027 : le ledger n enregistre plus de section.
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, reference_id, created_by,
    from_section_id, to_section_id, metadata
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, v_ref_type, v_ref_id, v_profile,
    NULL, NULL, v_meta
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES ('stock.movement', 'stock_movements', v_mvt_id,
    jsonb_build_object('movement_type', p_movement_type, 'quantity', p_quantity, 'unit', v_unit,
      'reason', p_reason, 'new_current_stock', v_new, 'idempotency_key', p_idempotency_key,
      'metadata', v_meta, 'allow_negative', p_allow_negative), v_profile);

  RETURN jsonb_build_object('movement_id', v_mvt_id, 'product_id', p_product_id,
    'new_current_stock', v_new, 'idempotent_replay', false);
END $function$;

-- ═══ 2. Production : plus de lot à la fournée ══════════════════════════════

CREATE OR REPLACE FUNCTION stock_private.record_production_v10(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text DEFAULT NULL::text, p_quantity_waste numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_recurse_subrecipes boolean DEFAULT true, p_expected_yield_qty numeric DEFAULT NULL::numeric, p_actual_yield_qty numeric DEFAULT NULL::numeric, p_yield_variance_reason text DEFAULT NULL::text, p_force_negative boolean DEFAULT false, p_waste_reason waste_reason DEFAULT NULL::waste_reason)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE   v_uid               UUID := auth.uid();   v_profile           UUID;
  v_product_unit      TEXT;   v_product_cost      DECIMAL(14,2);
  v_production_id     UUID;   v_production_number TEXT;
  v_total_factor      DECIMAL(14,4);   v_recipe_count      INT;
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
  END IF;   SELECT unit, cost_price, COALESCE(deduct_stock, true)     INTO v_product_unit, v_product_cost, v_deduct_stock
    FROM products     WHERE id = p_product_id AND deleted_at IS NULL;   IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';   END IF;   IF NOT v_deduct_stock THEN
    RAISE EXCEPTION 'production_requires_deduct_stock' USING ERRCODE='P0001',       HINT = 'ADR-008 D6: a product flagged as not tracking stock cannot be produced';   END IF;
  IF p_section_id IS NOT NULL      AND NOT EXISTS (SELECT 1 FROM sections WHERE id = p_section_id AND deleted_at IS NULL) THEN     RAISE EXCEPTION 'section_not_found' USING ERRCODE='P0002';
  END IF;   SELECT COUNT(*) INTO v_recipe_count     FROM recipes r
    WHERE r.product_id = p_product_id       AND r.is_active = TRUE       AND r.deleted_at IS NULL;
  IF v_recipe_count = 0 THEN     RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002';   END IF;
  v_total_factor := p_quantity_produced + p_quantity_waste;   DROP TABLE IF EXISTS pg_temp._bom_flatten;   DROP TABLE IF EXISTS pg_temp._leaf_consumption;
  CREATE TEMP TABLE _bom_flatten (     material_id    UUID,     material_name  TEXT,
    material_unit  TEXT,     material_cost  DECIMAL(14,2),     material_stock NUMERIC,
    recipe_unit    TEXT,     qty_in_recipe_unit NUMERIC,     depth          INT,
    sub_path       UUID[],     is_intermediate BOOLEAN,     is_stocked     BOOLEAN
  ) ON COMMIT DROP;   WITH RECURSIVE flatten AS (     SELECT
      r.material_id,       m.name AS material_name,       m.unit AS material_unit,
      m.cost_price AS material_cost,       m.current_stock AS material_stock,       r.unit AS recipe_unit,
      (r.quantity * v_total_factor)::NUMERIC AS qty_in_recipe_unit,       1 AS depth,       ARRAY[p_product_id]::UUID[] AS sub_path,
      EXISTS (         SELECT 1 FROM recipes r2 WHERE r2.product_id = r.material_id           AND r2.is_active = TRUE AND r2.deleted_at IS NULL
      ) AS is_intermediate,       COALESCE(m.track_inventory, TRUE) AS is_stocked     FROM recipes r
    JOIN products m ON m.id = r.material_id     WHERE r.product_id = p_product_id       AND r.is_active = TRUE
      AND r.deleted_at IS NULL     UNION ALL     SELECT
      r.material_id,       m.name,       m.unit,
      m.cost_price,       m.current_stock,       r.unit,
      (convert_quantity(f.qty_in_recipe_unit, f.recipe_unit, f.material_unit) * r.quantity)::NUMERIC,       f.depth + 1,       f.sub_path || f.material_id,
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
    material_unit  TEXT,     material_cost  DECIMAL(14,2),     material_stock NUMERIC,
    total_consumed NUMERIC   ) ON COMMIT DROP;   INSERT INTO _leaf_consumption (material_id, material_name, material_unit, material_cost, material_stock, total_consumed)
  SELECT     f.material_id,     MAX(f.material_name),
    MAX(f.material_unit),     MAX(f.material_cost),     MAX(f.material_stock),
    round(SUM(       CASE         WHEN f.recipe_unit = f.material_unit THEN f.qty_in_recipe_unit
        ELSE convert_quantity(f.qty_in_recipe_unit, f.recipe_unit, f.material_unit)       END     ), 9)
  FROM _bom_flatten f   WHERE     CASE
      WHEN p_recurse_subrecipes THEN (f.is_intermediate = FALSE OR f.is_stocked = TRUE)       ELSE f.depth = 1     END
  GROUP BY f.material_id;
  IF EXISTS (SELECT 1 FROM _leaf_consumption WHERE total_consumed = 0) THEN
    RAISE EXCEPTION 'quantity_below_stock_precision' USING ERRCODE = 'P0001';
  END IF;
  FOR v_rec IN SELECT * FROM _leaf_consumption LOOP     IF v_rec.material_stock < v_rec.total_consumed THEN
      v_missing := v_missing || jsonb_build_object(         'material_id',   v_rec.material_id,         'material_name', v_rec.material_name,
        'required',      v_rec.total_consumed,         'available',     v_rec.material_stock,         'shortfall',     v_rec.total_consumed - v_rec.material_stock,
        'unit',          v_rec.material_unit       );     END IF;
  END LOOP;   IF NOT v_allow_negative AND jsonb_array_length(v_missing) > 0 THEN     RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002', DETAIL = v_missing::text;
  END IF;   v_production_number := 'PROD-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')     || '-'     || stock_private.format_production_sequence(nextval('production_records_seq'));
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
    ELSE NULL   END;   v_in_result := record_stock_movement_v2(
    p_product_id      := p_product_id,     p_movement_type   := 'production_in',     p_quantity        := v_actual_yield,
    p_reason          := 'Production batch ' || v_production_number,     p_unit_cost       := v_unit_cost_in,     p_supplier_id     := NULL,
    p_idempotency_key := p_idempotency_key,     p_unit            := v_product_unit,     p_from_section_id := NULL,
    p_to_section_id   := p_section_id,     p_metadata        := jsonb_build_object(                           'production_id',       v_production_id,
                          'production_number',   v_production_number,                           'batch_number',        p_batch_number,                           'expected_yield_qty',  v_expected_yield,
                          'actual_yield_qty',    v_actual_yield,                           'waste_reason',        p_waste_reason                          ),
    p_allow_negative := v_actual_yield > 0   );   v_movement_id := (v_in_result->>'movement_id')::uuid;
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
  END IF;   FOR v_rec IN SELECT * FROM _leaf_consumption ORDER BY material_name LOOP     v_out_result := record_stock_movement_v2(
      p_product_id      := v_rec.material_id,       p_movement_type   := 'production_out',       p_quantity        := -v_rec.total_consumed,
      p_reason          := 'Material consumed by ' || v_production_number,       p_unit_cost       := v_rec.material_cost,       p_supplier_id     := NULL,
      p_idempotency_key := NULL,       p_unit            := v_rec.material_unit,       p_from_section_id := p_section_id,
      p_to_section_id   := NULL,       p_metadata        := jsonb_build_object(                             'production_id',     v_production_id,
                            'production_number', v_production_number,                             'material_id',       v_rec.material_id,                             'cascade',           p_recurse_subrecipes
                           ),       p_allow_negative  := v_allow_negative
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
      'movements_count',       v_movements_count,       'je_count',              v_je_count,
      'idempotency_key',       p_idempotency_key,       'recurse_subrecipes',    p_recurse_subrecipes,       'cascade_rule',          'adr016_stop_at_stocked',
      'recipe_version_id',     v_recipe_version_id,       'depth_reached',         v_max_depth_reached,       'expected_yield_qty',    v_expected_yield,
      'actual_yield_qty',      v_actual_yield,       'yield_variance_reason', v_yield_reason,       'force_negative',        v_allow_negative,
      'shortages',             CASE WHEN v_allow_negative THEN v_missing ELSE '[]'::JSONB END     ),     v_profile
  );   RETURN jsonb_build_object(     'production_id',         v_production_id,
    'production_number',     v_production_number,     'movements_count',       v_movements_count,
    'je_count',              v_je_count,     'idempotent_replay',     false,     'recipe_version_id',     v_recipe_version_id,
    'depth_reached',         v_max_depth_reached,     'materials_breakdown',   v_breakdown,     'expected_yield_qty',    v_expected_yield,
    'actual_yield_qty',      v_actual_yield,     'yield_variance_reason', v_yield_reason,     'waste_reason',          p_waste_reason,
    'waste_expense',         v_waste_cost,     'materials_cost',        v_total_consumed,     'forced_negative',       v_allow_negative,
    'shortages',             CASE WHEN v_allow_negative THEN v_missing ELSE '[]'::JSONB END   ); END $function$;

-- ═══ 3. Réception de bon de commande : v7 sans lot ═════════════════════════

CREATE FUNCTION public.receive_purchase_order_v7(p_po_id uuid, p_received_items jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid             UUID := auth.uid();
  v_profile         UUID;
  v_po              RECORD;
  v_existing_grn    UUID;
  v_existing_no     TEXT;
  v_grn_id          UUID;
  v_grn_number      TEXT;
  v_grn_subtotal    DECIMAL(14,2) := 0;
  v_grn_vat         DECIMAL(14,2);
  v_grn_total       DECIMAL(14,2);
  v_movements_count INT := 0;
  v_je_id           UUID;
  v_item            JSONB;
  v_po_item_id      UUID;
  v_received_qty    DECIMAL(14,3);
  v_base_qty        DECIMAL(14,3);
  v_base_unit_cost  DECIMAL(14,2);
  v_po_item         RECORD;
  v_product         RECORD;
  v_mv_idem_key     UUID;
  v_mv_result       JSONB;
  v_total_ordered   DECIMAL(14,3);
  v_total_received  DECIMAL(14,3);
  v_new_status      TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_received_items IS NULL
     OR jsonb_typeof(p_received_items) <> 'array'
     OR jsonb_array_length(p_received_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, grn_number INTO v_existing_grn, v_existing_no
      FROM goods_receipt_notes WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_grn IS NOT NULL THEN
      -- Le chemin d'écriture ne stampe pas reference_type='purchase_order' :
      -- metadata->>'grn_id' est la seule clé fiable.
      SELECT COUNT(*) INTO v_movements_count
        FROM stock_movements
        WHERE metadata->>'grn_id' = v_existing_grn::text;
      SELECT id INTO v_je_id FROM journal_entries
        WHERE reference_type = 'purchase' AND reference_id = v_existing_grn LIMIT 1;
      RETURN jsonb_build_object(
        'grn_id',            v_existing_grn,
        'grn_number',        v_existing_no,
        'je_id',             v_je_id,
        'movements_count',   v_movements_count,
        'status',            (SELECT status FROM purchase_orders WHERE id = p_po_id),
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_po.status NOT IN ('pending','partial') THEN
    RAISE EXCEPTION 'po_invalid_status: %', v_po.status USING ERRCODE = 'P0002';
  END IF;

  -- Une ligne PO ne peut contribuer qu'une fois à une même réception.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_received_items) AS item
    WHERE item->>'po_item_id' IS NOT NULL
    GROUP BY (item->>'po_item_id')::uuid
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_po_item' USING ERRCODE = 'P0001';
  END IF;

  v_grn_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_received_items) LOOP
    v_po_item_id   := (v_item->>'po_item_id')::uuid;
    v_received_qty := (v_item->>'received_quantity')::numeric;

    IF v_po_item_id IS NULL THEN
      RAISE EXCEPTION 'po_item_id_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_received_qty IS NULL OR v_received_qty <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_po_item FROM purchase_order_items
      WHERE id = v_po_item_id AND po_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'po_item_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_received_qty > (v_po_item.quantity - v_po_item.received_quantity) THEN
      RAISE EXCEPTION 'received_exceeds_ordered: po_item=% remaining=% requested=%',
        v_po_item_id, (v_po_item.quantity - v_po_item.received_quantity), v_received_qty
        USING ERRCODE = 'P0001';
    END IF;

    SELECT id, unit
      INTO v_product
      FROM products
      WHERE id = v_po_item.product_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Convert BOTH quantity AND unit cost to the base unit.
    v_base_qty := round(v_received_qty * v_po_item.unit_factor_to_base, 10);
    v_base_unit_cost := CASE
      WHEN v_po_item.unit_cost IS NULL THEN NULL
      -- NON-PKP : la PPN non récupérable suit le prorata déjà porté par le GRN.
      ELSE round(v_po_item.unit_cost
        * (1 + CASE WHEN v_po.subtotal > 0 THEN v_po.vat_amount / v_po.subtotal ELSE 0 END)
        / NULLIF(v_po_item.unit_factor_to_base, 0), 2)
    END;

    v_mv_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':mv:' || v_po_item_id::text)::uuid
    END;

    v_mv_result := record_stock_movement_v2(
      p_product_id      := v_product.id,
      p_movement_type   := 'purchase',
      p_quantity        := v_base_qty,
      p_reason          := 'Receipt against PO ' || v_po.po_number,
      p_unit_cost       := v_base_unit_cost,
      p_supplier_id     := v_po.supplier_id,
      p_idempotency_key := v_mv_idem_key,
      p_unit            := v_product.unit,
      p_from_section_id := NULL,
      p_to_section_id   := NULL,
      p_metadata        := jsonb_build_object(
                            'po_id',              p_po_id,
                            'po_number',          v_po.po_number,
                            'po_item_id',         v_po_item_id,
                            'grn_id',             v_grn_id,
                            'po_line_unit',       v_po_item.unit,
                            'po_line_qty',        v_received_qty,
                            'po_line_unit_cost',  v_po_item.unit_cost,
                            'unit_factor_to_base', v_po_item.unit_factor_to_base
                           )
    );
    v_movements_count := v_movements_count + 1;

    UPDATE purchase_order_items
      SET received_quantity = received_quantity + v_received_qty,
          updated_at        = now()
      WHERE id = v_po_item_id;

    v_grn_subtotal := v_grn_subtotal + round(v_received_qty * v_po_item.unit_cost, 2);
  END LOOP;

  IF v_po.subtotal > 0 THEN
    v_grn_vat := round(v_po.vat_amount * (v_grn_subtotal / v_po.subtotal), 2);
  ELSE
    v_grn_vat := 0;
  END IF;
  v_grn_total := v_grn_subtotal + v_grn_vat;

  v_grn_number := 'GRN-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('goods_receipt_notes_seq')::text, 4, '0');

  INSERT INTO goods_receipt_notes (
    id, grn_number, po_id, received_by, received_date, payment_terms,
    subtotal, vat_amount, total, notes, idempotency_key,
    metadata
  ) VALUES (
    v_grn_id, v_grn_number, p_po_id, v_profile, current_date, v_po.payment_terms,
    v_grn_subtotal, v_grn_vat, v_grn_total, NULL, p_idempotency_key,
    jsonb_build_object(
      'po_number',   v_po.po_number,
      'supplier_id', v_po.supplier_id,
      'lines',       jsonb_array_length(p_received_items)
    )
  );

  SELECT id INTO v_je_id FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = v_grn_id LIMIT 1;

  SELECT SUM(quantity), SUM(received_quantity)
    INTO v_total_ordered, v_total_received
    FROM purchase_order_items WHERE po_id = p_po_id;

  IF v_total_received >= v_total_ordered THEN
    v_new_status := 'received';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE purchase_orders
    SET status        = v_new_status,
        received_by   = COALESCE(received_by, v_profile),
        received_date = CASE WHEN v_new_status = 'received' THEN current_date
                             ELSE received_date END,
        updated_at    = now()
    WHERE id = p_po_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile,
    'purchase_order.received',
    'purchase_orders',
    p_po_id,
    jsonb_build_object(
      'po_number',       v_po.po_number,
      'grn_id',          v_grn_id,
      'grn_number',      v_grn_number,
      'movements_count', v_movements_count,
      'subtotal',        v_grn_subtotal,
      'vat_amount',      v_grn_vat,
      'total',           v_grn_total,
      'new_status',      v_new_status,
      'idempotency_key', p_idempotency_key,
      'rpc_version',     'v7'
    )
  );

  RETURN jsonb_build_object(
    'grn_id',            v_grn_id,
    'grn_number',        v_grn_number,
    'je_id',             v_je_id,
    'movements_count',   v_movements_count,
    'subtotal',          v_grn_subtotal,
    'vat_amount',        v_grn_vat,
    'total',             v_grn_total,
    'status',            v_new_status,
    'idempotent_replay', false
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.receive_purchase_order_v7(uuid, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_purchase_order_v7(uuid, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order_v7(uuid, jsonb, uuid) TO authenticated, service_role;
DROP FUNCTION public.receive_purchase_order_v6(uuid, jsonb, uuid);

-- ═══ 4. Annulation de production : v5 sans remise à zéro de lot ═══════════

CREATE FUNCTION public.revert_production_v5(p_production_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_pr            RECORD;
  v_orig_mv       RECORD;
  v_orig_je       RECORD;
  v_je_line       RECORD;
  v_new_je_id     UUID;
  v_entry_no      TEXT;
  v_mv_count      INT := 0;
  v_je_count      INT := 0;
  v_in_created_at TIMESTAMPTZ;
  v_blockers      JSONB := '[]'::JSONB;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.delete') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT * INTO v_pr FROM production_records WHERE id = p_production_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_pr.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_reverted' USING ERRCODE='P0001';
  END IF;

  IF v_pr.production_date < now() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'production_too_old' USING ERRCODE='P0001';
  END IF;

  -- Sérialiser le contrôle des sorties et la contrepassation avec les écrivains stock.
  -- La lecture des sorties reste une instruction séparée après une éventuelle attente.
  PERFORM 1 FROM products WHERE id = v_pr.product_id FOR UPDATE;

  SELECT sm.created_at INTO v_in_created_at
    FROM stock_movements sm
   WHERE sm.metadata->>'production_id' = p_production_id::text
     AND sm.movement_type = 'production_in'
     AND COALESCE(sm.metadata->>'reverse_of_production','false') = 'false'
   ORDER BY sm.created_at
   LIMIT 1;

  IF v_in_created_at IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'movement_id',   x.id,
               'movement_type', x.movement_type,
               'quantity',      x.quantity,
               'occurred_at',   x.created_at,
               'reason',        x.reason
             ) ORDER BY x.created_at), '[]'::JSONB)
      INTO v_blockers
      FROM stock_movements x
     WHERE x.product_id = v_pr.product_id
       AND x.quantity < 0
       AND x.created_at >= v_in_created_at
       AND COALESCE(x.metadata->>'production_id','') <> p_production_id::text;

    IF jsonb_array_length(v_blockers) > 0 THEN
      RAISE EXCEPTION 'already_consumed' USING ERRCODE='P0001',
        DETAIL = v_blockers::text,
        HINT = 'The produced stock has already left inventory. Correct it with a stock adjustment (adjust_stock) instead of reverting the production.';
    END IF;
  END IF;

  FOR v_orig_mv IN
    SELECT sm.*
      FROM stock_movements sm
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND COALESCE(sm.metadata->>'reverse_of_production','false') = 'false'
        AND sm.movement_type IN ('production_in','production_out')
      ORDER BY sm.created_at
  LOOP
    PERFORM record_stock_movement_v2(
      p_product_id      := v_orig_mv.product_id,
      p_movement_type   := v_orig_mv.movement_type,
      p_quantity        := -v_orig_mv.quantity,
      p_reason          := 'Reversal of ' || v_orig_mv.reason,
      p_unit_cost       := v_orig_mv.unit_cost,
      p_supplier_id     := v_orig_mv.supplier_id,
      p_idempotency_key := NULL,
      p_unit            := v_orig_mv.unit,
      p_from_section_id := v_orig_mv.to_section_id,
      p_to_section_id   := v_orig_mv.from_section_id,
      p_metadata        := jsonb_build_object(
                            'reverse_of_production',  true,
                            'original_movement_id',   v_orig_mv.id,
                            'production_id',          p_production_id,
                            'production_number',      v_pr.production_number,
                            'reason',                 p_reason
                           ),
      p_allow_negative  := TRUE
    );
    v_mv_count := v_mv_count + 1;
  END LOOP;

  FOR v_orig_je IN
    SELECT je.id AS je_id, je.entry_date, je.total_debit, je.total_credit, je.reference_id, je.metadata
      FROM journal_entries je
      JOIN stock_movements sm ON sm.id = je.reference_id
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND je.reference_type = 'stock_movement'
        AND COALESCE(je.metadata->>'reverse_of_production','false') = 'false'
  LOOP
    PERFORM check_fiscal_period_open(now()::date);
    v_entry_no := next_journal_entry_number(now()::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by, metadata
    ) VALUES (
      v_entry_no,
      now()::date,
      'Reversal of production ' || v_pr.production_number,
      'production',
      p_production_id,
      'posted',
      v_orig_je.total_debit,
      v_orig_je.total_credit,
      v_profile,
      jsonb_build_object(
        'reverse_of_production', true,
        'original_je_id',        v_orig_je.je_id,
        'production_id',         p_production_id,
        'production_number',     v_pr.production_number,
        'reason',                p_reason,
        'movement_type',         'reversal:' || (v_orig_je.metadata->>'movement_type') || ':' || v_orig_je.je_id::text
      )
    ) RETURNING id INTO v_new_je_id;

    FOR v_je_line IN
      SELECT account_id, debit, credit, description
        FROM journal_entry_lines
        WHERE journal_entry_id = v_orig_je.je_id
    LOOP
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (
          v_new_je_id,
          v_je_line.account_id,
          v_je_line.credit,
          v_je_line.debit,
          'Reversal: ' || v_je_line.description
        );
    END LOOP;

    v_je_count := v_je_count + 1;
  END LOOP;

  UPDATE production_records
    SET reverted_at        = now(),
        reverted_by        = v_profile,
        reverted_reason    = p_reason,
        materials_consumed = FALSE,
        stock_updated      = FALSE,
        je_posted          = FALSE,
        updated_at         = now()
    WHERE id = p_production_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'production.revert', 'production_records', p_production_id,
    jsonb_build_object(
      'reason',                  p_reason,
      'reverse_movements_count', v_mv_count,
      'reverse_je_count',        v_je_count
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'production_id',           p_production_id,
    'reverse_movements_count', v_mv_count,
    'reverse_je_count',        v_je_count
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.revert_production_v5(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_production_v5(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.revert_production_v5(uuid, text) TO authenticated, service_role;
DROP FUNCTION public.revert_production_v4(uuid, text);

-- ═══ 5. Tableau de bord produit : v9 sans section « lots » ════════════════

CREATE FUNCTION public.get_product_dashboard_v9(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days  INT;
  v_since TIMESTAMPTZ;
  v_summary JSONB;
  v_recent_movements JSONB;
  v_velocity_daily   JSONB;
  v_top_customers    JSONB;
  v_product_row      JSONB;
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  v_days  := GREATEST(COALESCE(p_days, 30), 1);
  v_since := now() - (v_days * INTERVAL '1 day');
  -- Compatibilité prod : la visibilité par journée n'y est pas encore installée.
  IF to_regprocedure('public.assert_business_days_visible_v2(date,date)') IS NOT NULL THEN
    PERFORM public.assert_business_days_visible_v2(v_since::date,current_date);
  END IF;

  SELECT jsonb_build_object(
           'id',                  p.id,
           'sku',                 p.sku,
           'name',                p.name,
           'unit',                p.unit,
           'cost_price',          p.cost_price,
           'retail_price',        p.retail_price,
           'current_stock',       p.current_stock,
           'min_stock_threshold', p.min_stock_threshold,
           'value_at_cost',       (p.current_stock * p.cost_price)
         )
    INTO v_product_row
    FROM products p
   WHERE p.id = p_product_id;

  IF v_product_row IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_recent_movements
  FROM (
    SELECT
      sm.id,
      sm.movement_type::TEXT AS movement_type,
      sm.quantity,
      sm.unit,
      sm.reason,
      sm.from_section_id,
      fs.code AS from_section_code,
      sm.to_section_id,
      ts.code AS to_section_code,
      sm.created_at
    FROM stock_movements sm
    LEFT JOIN sections fs ON fs.id = sm.from_section_id
    LEFT JOIN sections ts ON ts.id = sm.to_section_id
    WHERE sm.product_id = p_product_id
    ORDER BY sm.created_at DESC
    LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.day), '[]'::JSONB)
    INTO v_velocity_daily
  FROM (
    SELECT
      day::DATE                   AS day,
      COALESCE(SUM(units), 0)     AS units_sold
    FROM (
      SELECT generate_series(v_since::DATE, now()::DATE, '1 day'::INTERVAL) AS day
    ) cal
    LEFT JOIN LATERAL (
      SELECT ABS(sm.quantity) AS units
      FROM stock_movements sm
      WHERE sm.product_id = p_product_id
        AND sm.movement_type IN ('sale','production_out')
        AND sm.created_at::DATE = cal.day
    ) flat ON true
    GROUP BY day
  ) d;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.units_bought DESC), '[]'::JSONB)
    INTO v_top_customers
  FROM (
    SELECT
      c.id           AS customer_id,
      c.name         AS customer_name,
      SUM(oi.quantity) AS units_bought,
      SUM(oi.line_total) AS spend_total
    FROM reporting_private.closed_order_items_v1 oi
    JOIN reporting_private.recognized_sales_v2 o     ON o.id = oi.order_id
    JOIN customers c  ON c.id = o.customer_id
    WHERE oi.product_id = p_product_id
      AND TRUE
      AND o.recognized_at >= v_since
      AND c.deleted_at IS NULL
    GROUP BY c.id, c.name
    ORDER BY SUM(oi.quantity) DESC
    LIMIT 5
  ) t;

  SELECT jsonb_build_object(
           'window_days',     v_days,
           'units_sold',      COALESCE(SUM(ABS(sm.quantity)), 0),
           'avg_daily_units', (COALESCE(SUM(ABS(sm.quantity)), 0) / v_days::DECIMAL),
           'last_movement_at',MAX(sm.created_at)
         )
    INTO v_summary
    FROM stock_movements sm
   WHERE sm.product_id = p_product_id
     AND sm.created_at >= v_since
     AND sm.movement_type IN ('sale','production_out');

  RETURN jsonb_build_object(
    'product',           v_product_row,
    'summary',           COALESCE(v_summary, jsonb_build_object(
                            'window_days', v_days, 'units_sold', 0,
                            'avg_daily_units', 0, 'last_movement_at', NULL)),
    'recent_movements',  v_recent_movements,
    'sales_velocity_daily', v_velocity_daily,
    'top_customers',     v_top_customers
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.get_product_dashboard_v9(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_dashboard_v9(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_product_dashboard_v9(uuid, integer) TO authenticated, service_role;
DROP FUNCTION public.get_product_dashboard_v8(uuid, integer);

-- ═══ 6. Retraits ═══════════════════════════════════════════════════════════

-- La tâche planifiée n'existe qu'en dev ; en production, rien à retirer.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE command ILIKE '%mark_expired_lots_hourly%') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE command ILIKE '%mark_expired_lots_hourly%';
  END IF;
END $do$;

DROP FUNCTION public.mark_expired_lots_hourly();
DROP FUNCTION public.create_stock_lot_v1(uuid, numeric, text, uuid, timestamp with time zone, text, uuid, jsonb);
DROP FUNCTION public._kitchen_stock_lot_v1(uuid, numeric, text, uuid, timestamp with time zone, text, uuid, jsonb);
DROP FUNCTION public._resolve_fifo_lot(uuid, numeric);
DROP FUNCTION public.get_expiring_lots_v1(integer, uuid, integer, integer);
DROP FUNCTION public.get_perishable_turnover_v1(text, text);

ALTER TABLE public.business_config DROP COLUMN production_yield_variance_threshold_pct;

COMMENT ON TABLE public.stock_lots IS
  'Dormante depuis 2026-11-18 (ADR-004, S2-01) : historique en lecture seule. Aucune fonction ne la lit pour un mouvement ni ne l''écrit.';

-- Défense en profondeur : les nouvelles fonctions du schéma ne s'ouvrent pas à PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
