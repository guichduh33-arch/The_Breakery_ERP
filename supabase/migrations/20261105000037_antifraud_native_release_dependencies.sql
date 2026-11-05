-- Dépendances natives absentes de la chaîne historique, capturées sur DEV le 5 novembre 2026.
-- Une fonction déjà publiée reste intacte ; un corps différent bloque la livraison.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $bootstrap$
DECLARE f record; v_function regprocedure;
BEGIN
 FOR f IN SELECT * FROM (VALUES
  ('stock_private.record_production_v8(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)', '12588c62025d406f5fb0a755458e063e', $body0$CREATE OR REPLACE FUNCTION stock_private.record_production_v8(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text DEFAULT NULL::text, p_quantity_waste numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_recurse_subrecipes boolean DEFAULT true, p_expected_yield_qty numeric DEFAULT NULL::numeric, p_actual_yield_qty numeric DEFAULT NULL::numeric, p_yield_variance_reason text DEFAULT NULL::text, p_force_negative boolean DEFAULT false, p_waste_reason waste_reason DEFAULT NULL::waste_reason)
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
    p_lot_id          := v_lot_id, p_allow_negative := v_actual_yield > 0   );   v_movement_id := (v_in_result->>'movement_id')::uuid;
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
$body0$),
  ('stock_private.pay_existing_order_v23(uuid,jsonb,uuid,integer,uuid,numeric,text,numeric,text,uuid,uuid,jsonb,jsonb,boolean,boolean)', 'bb79564c6b975b4202dede98eb47315a', $body1$CREATE OR REPLACE FUNCTION stock_private.pay_existing_order_v23(p_order_id uuid, p_payment jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_loyalty_points_redeemed integer DEFAULT 0, p_idempotency_key uuid DEFAULT NULL::uuid, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT NULL::text, p_discount_value numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_discount_auth_id uuid DEFAULT NULL::uuid, p_promotions jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT NULL::jsonb, p_offline_replay boolean DEFAULT false, p_outstanding boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_gift jsonb; v_gift_qty numeric; v_existing_gift_qty numeric; v_gift_stations text[];
  v_cmp products%ROWTYPE;  -- audit lot 2 P0-5 : drapeaux du composant de combo
  v_user_id              UUID;   v_profile_id           UUID;   v_order                orders;
  v_items_total          DECIMAL(14,2) := 0;   v_allow_negative       BOOLEAN;   v_redemption_amount    DECIMAL(14,2) := 0;
  v_total                DECIMAL(14,2);   v_post_promo           DECIMAL(14,2);   v_tax_amount           DECIMAL(14,2);
  v_loyalty_balance      INTEGER;   v_points_earned        INTEGER := 0;   v_je_id                UUID;
  v_loyalty_liab_id      UUID;   v_sale_discount_id     UUID;   v_item                 RECORD;
  v_promo                JSONB;   v_promotion_total      DECIMAL(14,2) := 0;   v_promo_id             UUID;
  v_promo_amount         DECIMAL(14,2);   v_promo_record         promotions;   v_customer_category_id UUID;
  v_now                  TIMESTAMPTZ := now();   v_now_dow              INTEGER;   v_now_hour             INTEGER;
  v_payments_arr         JSONB;   v_sc_amount            NUMERIC(14,2) := 0;   v_sc_balance           NUMERIC(14,2);
  v_payment_entry        JSONB;   v_pay_count            INTEGER;   v_pay_idx              INTEGER;
  v_pay_sum              DECIMAL(14,2) := 0;   v_pay_method           payment_method;   v_pay_amount           DECIMAL(14,2);
  v_pay_cash_recv        DECIMAL(14,2);   v_pay_change           DECIMAL(14,2);   v_total_change         DECIMAL(14,2) := 0;
  v_authorizer_uid       UUID;   v_loyalty_multiplier   NUMERIC := 1.0;   v_server_eval          JSONB;
  v_server_amount        DECIMAL(14,2);   v_eval_items           JSONB;   v_eval_subtotal        DECIMAL(14,2) := 0;
  v_comp                 JSONB;   v_comp_qty             DECIMAL(10,3);   v_ing                  RECORD;
  v_cons                 RECORD;   v_cap_max_uses         INT;   v_cap_max_per_customer INT;
  v_uses_global          INT;   v_uses_customer        INT; BEGIN
  v_user_id := auth.uid();   IF v_user_id IS NULL THEN     RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;    SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;   IF v_profile_id IS NULL THEN     RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;    IF NOT has_permission(v_user_id, 'payments.process') THEN
    RAISE EXCEPTION 'Permission denied: payments.process' USING ERRCODE = 'P0003';   END IF; 
  IF p_idempotency_key IS NOT NULL THEN     SELECT id INTO v_order.id FROM orders WHERE idempotency_key = p_idempotency_key;     IF v_order.id IS NOT NULL THEN
      RETURN (         SELECT jsonb_build_object(           'order_id',          o.id,
          'order_number', o.order_number, 'order_snapshot', public._pos_order_snapshot_data_v1(o.id),           'subtotal',          o.subtotal,           'tax_amount',        o.tax_amount,
          'total',             o.total,           'change_given',      (SELECT COALESCE(SUM(op.change_given), 0)                                   FROM order_payments op WHERE op.order_id = o.id),
          'loyalty_points_earned', COALESCE(o.loyalty_points_earned, 0),           'idempotent_replay', true         ) FROM orders o WHERE o.id = v_order.id
      );     END IF;   END IF;
   IF p_discount_amount > 0 THEN     IF p_discount_authorized_by IS NULL THEN
      RAISE EXCEPTION 'Discount requires an authorizing manager (p_discount_authorized_by)'         USING ERRCODE = 'P0014';     END IF;
    SELECT up.auth_user_id INTO v_authorizer_uid       FROM user_profiles up       WHERE up.id = p_discount_authorized_by AND up.deleted_at IS NULL;
    IF v_authorizer_uid IS NULL THEN       RAISE EXCEPTION 'Discount authorizer not found' USING ERRCODE = 'P0003';     END IF;
    IF NOT has_permission(v_authorizer_uid, 'sales.discount') THEN       RAISE EXCEPTION 'Permission denied: sales.discount (authorizer)' USING ERRCODE = 'P0003';     END IF;
    IF NOT p_offline_replay THEN       UPDATE discount_authorizations          SET consumed_at = now()
       WHERE id = p_discount_auth_id          AND consumed_at IS NULL          AND expires_at > now()
         AND scope = 'discount'          AND manager_profile_id = p_discount_authorized_by;       IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid manager PIN for discount authorization'           USING ERRCODE = 'P0003';       END IF;
    END IF;   END IF; 
  IF p_payments IS NOT NULL AND p_payment IS NOT NULL THEN     RAISE EXCEPTION 'Cannot supply both p_payment and p_payments' USING ERRCODE = 'check_violation';   END IF;
  IF p_payments IS NOT NULL THEN     v_payments_arr := p_payments;   ELSIF p_payment IS NOT NULL THEN
    v_payments_arr := jsonb_build_array(p_payment);   ELSE     RAISE EXCEPTION 'Must supply p_payment or p_payments' USING ERRCODE = 'check_violation';
  END IF;    v_pay_count := jsonb_array_length(v_payments_arr);
  IF v_pay_count < (CASE WHEN p_outstanding THEN 0 ELSE 1 END) OR v_pay_count > 5 THEN     RAISE EXCEPTION 'Invalid tender count: % (must be 1..5)', v_pay_count       USING ERRCODE = 'check_violation';
  END IF;    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
   IF v_order.id IS NULL THEN     RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;    IF NOT (v_order.status = 'draft'
          OR (v_order.status = 'pending_payment' AND v_order.created_via = 'pos')) THEN     RAISE EXCEPTION 'Order is not payable (status: %, via: %)', v_order.status, v_order.created_via       USING ERRCODE = 'check_violation';
  END IF;    IF p_loyalty_points_redeemed > 0 THEN
    IF p_customer_id IS NULL THEN       RAISE EXCEPTION 'Cannot redeem points without customer attached'         USING ERRCODE = 'check_violation';
    END IF;     IF p_loyalty_points_redeemed % 100 <> 0 THEN       RAISE EXCEPTION 'Points must be a multiple of 100'
        USING ERRCODE = 'check_violation';     END IF;     SELECT loyalty_points INTO v_loyalty_balance
      FROM customers WHERE id = p_customer_id;     IF v_loyalty_balance < p_loyalty_points_redeemed THEN       RAISE EXCEPTION 'Insufficient loyalty points (balance: %)', v_loyalty_balance
        USING ERRCODE = 'P0010';     END IF;     v_redemption_amount := p_loyalty_points_redeemed * 10;
  END IF;    -- ADR-013 Lot 4 (D8) : paiement par avoir gate serveur -- client rattache +
  -- solde suffisant, verifie sous verrou (lock-then-check, patron B2B _139).
  -- Positionne AVANT les verrous produits pour fixer l'ordre de verrouillage
  -- customers -> products (anti-deadlock entre les deux money-path RPCs).
  SELECT COALESCE(SUM((e->>'amount')::NUMERIC), 0) INTO v_sc_amount     FROM jsonb_array_elements(v_payments_arr) e    WHERE e->>'method' = 'store_credit';
  IF v_sc_amount > 0 THEN     IF p_customer_id IS NULL THEN       RAISE EXCEPTION 'Store credit payment requires a customer'
        USING ERRCODE = 'P0015';     END IF;     SELECT store_credit_balance INTO v_sc_balance
      FROM customers WHERE id = p_customer_id AND deleted_at IS NULL       FOR UPDATE;     IF v_sc_balance IS NULL THEN
      RAISE EXCEPTION 'Customer not found: %', p_customer_id USING ERRCODE = 'P0002';     END IF;     IF v_sc_balance < v_sc_amount THEN
      RAISE EXCEPTION 'Insufficient store credit (balance: %)', v_sc_balance         USING ERRCODE = 'P0016';     END IF;
  END IF;    SELECT COALESCE(allow_negative_stock, true)
    INTO v_allow_negative     FROM business_config WHERE id = 1; 
  IF p_offline_replay THEN     v_allow_negative := true;   END IF;
   SELECT COALESCE(SUM(line_total), 0)     INTO v_items_total
    FROM order_items     WHERE order_id = p_order_id       AND is_cancelled = false;
   SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)     INTO v_eval_subtotal
    FROM order_items oi     WHERE oi.order_id = p_order_id AND oi.is_cancelled = false AND oi.is_promo_gift = false; 
  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN     v_now_dow  := EXTRACT(ISODOW FROM v_now)::INTEGER;     v_now_hour := EXTRACT(HOUR  FROM v_now)::INTEGER;
     IF p_customer_id IS NOT NULL THEN       SELECT category_id INTO v_customer_category_id
        FROM customers WHERE id = p_customer_id;     END IF; 
    SELECT COALESCE(jsonb_agg(jsonb_build_object(              'product_id', oi.product_id::text,              'quantity',   oi.quantity,
             'unit_price', oi.unit_price)), '[]'::jsonb)       INTO v_eval_items       FROM order_items oi
      WHERE oi.order_id = p_order_id AND oi.is_cancelled = false AND oi.is_promo_gift = false;      v_server_eval := evaluate_promotions_v3(
      p_cart_items  := v_eval_items,       p_customer_id := p_customer_id,       p_subtotal    := v_eval_subtotal
    );      FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
      v_promo_id     := (v_promo->>'promotion_id')::UUID;       v_promo_amount := (v_promo->>'amount')::DECIMAL(14,2); 
      IF v_promo_amount IS NULL OR v_promo_amount < 0 THEN         RAISE EXCEPTION 'Invalid promotion amount for %: %', v_promo_id, v_promo_amount           USING ERRCODE = 'check_violation';
      END IF;        SELECT * INTO v_promo_record FROM promotions
        WHERE id = v_promo_id AND is_active = true AND deleted_at IS NULL;       IF v_promo_record.id IS NULL THEN         RAISE EXCEPTION 'Promotion not found or inactive: %', v_promo_id
          USING ERRCODE = 'check_violation';       END IF; 
      IF v_promo_record.start_at IS NOT NULL AND v_promo_record.start_at > v_now THEN         RAISE EXCEPTION 'Promotion not yet active: %', v_promo_record.slug           USING ERRCODE = 'check_violation';
      END IF;       IF v_promo_record.end_at IS NOT NULL AND v_promo_record.end_at < v_now THEN         RAISE EXCEPTION 'Promotion expired: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';       END IF; 
      IF (v_promo_record.day_of_week_mask & (1 << (v_now_dow - 1))) = 0 THEN         RAISE EXCEPTION 'Promotion not valid this day: %', v_promo_record.slug           USING ERRCODE = 'check_violation';
      END IF;        IF v_promo_record.start_hour IS NOT NULL THEN
        IF v_now_hour < v_promo_record.start_hour            OR v_now_hour >= v_promo_record.end_hour THEN           RAISE EXCEPTION 'Promotion not valid this hour: %', v_promo_record.slug
            USING ERRCODE = 'check_violation';         END IF;       END IF;
       IF v_items_total < v_promo_record.min_items_total THEN         RAISE EXCEPTION 'Promotion min total not met: % (required %)',
          v_promo_record.slug, v_promo_record.min_items_total           USING ERRCODE = 'check_violation';       END IF;
       IF array_length(v_promo_record.customer_category_ids, 1) > 0 THEN         IF p_customer_id IS NULL THEN
          RAISE EXCEPTION 'Promotion requires customer: %', v_promo_record.slug             USING ERRCODE = 'check_violation';         END IF;
        IF v_customer_category_id IS NULL            OR NOT (v_customer_category_id = ANY (v_promo_record.customer_category_ids)) THEN           RAISE EXCEPTION 'Promotion not valid for this customer category: %', v_promo_record.slug
            USING ERRCODE = 'check_violation';         END IF;       END IF;
       SELECT (sp->>'discount_amount')::DECIMAL(14,2) INTO v_server_amount         FROM jsonb_array_elements(v_server_eval->'applied_promotions') sp
        WHERE (sp->>'promotion_id')::uuid = v_promo_id         LIMIT 1;       IF v_server_amount IS NULL THEN
        RAISE EXCEPTION 'Promotion amount mismatch: % not applicable to this cart', v_promo_record.slug           USING ERRCODE = 'check_violation';       END IF;
      IF v_server_amount <> v_promo_amount THEN         RAISE EXCEPTION 'Promotion amount mismatch: % (client %, server %)',           v_promo_record.slug, v_promo_amount, v_server_amount
          USING ERRCODE = 'check_violation';       END IF; 
      v_promotion_total := v_promotion_total + v_promo_amount;     END LOOP;   END IF;
   -- ADR-013 D11 : gardes etagees, miroir exact de calculateTotals (packages/domain) :
  -- items -> promo -> redemption -> remise panier -> taxe.
  v_post_promo := v_items_total - v_promotion_total;   IF v_post_promo < 0 THEN     RAISE EXCEPTION 'Promotions exceed items total' USING ERRCODE = 'check_violation';
  END IF;   IF v_redemption_amount > v_post_promo THEN     RAISE EXCEPTION 'Redemption exceeds post-promotion total' USING ERRCODE = 'check_violation';
  END IF;   v_total := v_post_promo - v_redemption_amount - p_discount_amount;   IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts + promotions exceed items total' USING ERRCODE = 'check_violation';   END IF; 
  SELECT s.tax_amount, s.total     INTO v_tax_amount, v_total     FROM _pb1_split_v1(v_total) s;
   v_pay_idx := 0;   v_pay_sum := 0;
  v_total_change := 0;   FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP     v_pay_idx       := v_pay_idx + 1;
    v_pay_method    := (v_payment_entry->>'method')::payment_method;     v_pay_amount    := (v_payment_entry->>'amount')::DECIMAL(14,2);     v_pay_cash_recv := NULLIF(v_payment_entry->>'cash_received','')::DECIMAL(14,2);
    v_pay_change    := NULLIF(v_payment_entry->>'change_given','')::DECIMAL(14,2);      IF v_pay_amount IS NULL OR v_pay_amount <= 0 THEN
      RAISE EXCEPTION 'Tender %: amount must be > 0', v_pay_idx USING ERRCODE = 'check_violation';     END IF; 
    IF v_pay_cash_recv IS NOT NULL AND v_pay_cash_recv > v_pay_amount AND v_pay_idx < v_pay_count THEN       RAISE EXCEPTION 'Tender % (intermediate): cash_received cannot exceed amount', v_pay_idx         USING ERRCODE = 'check_violation';
    END IF;      IF v_pay_method = 'cash' THEN
      IF v_pay_cash_recv IS NOT NULL THEN         IF v_pay_cash_recv < v_pay_amount AND v_pay_idx = v_pay_count THEN           RAISE EXCEPTION 'Invalid change amount: cash_received (%) < amount (%)',
            v_pay_cash_recv, v_pay_amount USING ERRCODE = 'check_violation';         END IF;         IF COALESCE(v_pay_change, 0) <> GREATEST(v_pay_cash_recv - v_pay_amount, 0) THEN
          RAISE EXCEPTION 'Invalid change amount: change_given (%) != cash_received - amount (%)',             COALESCE(v_pay_change, 0), GREATEST(v_pay_cash_recv - v_pay_amount, 0)             USING ERRCODE = 'check_violation';
        END IF;       ELSIF COALESCE(v_pay_change, 0) <> 0 THEN         RAISE EXCEPTION 'Invalid change amount: change without cash_received'
          USING ERRCODE = 'check_violation';       END IF;     ELSIF COALESCE(v_pay_change, 0) <> 0 THEN
      RAISE EXCEPTION 'Invalid change amount: non-cash tender cannot give change'         USING ERRCODE = 'check_violation';     END IF;
     v_pay_sum := v_pay_sum + v_pay_amount;     IF v_pay_change IS NOT NULL THEN
      v_total_change := v_total_change + v_pay_change;     END IF;   END LOOP;
   IF v_pay_sum > v_total OR (NOT p_outstanding AND v_pay_sum <> v_total) THEN     RAISE EXCEPTION 'Sum of tender amounts (%) != order total (%)', v_pay_sum, v_total
      USING ERRCODE = 'check_violation';   END IF; 
  IF p_outstanding THEN
    IF p_offline_replay THEN RAISE EXCEPTION 'outstanding_unavailable_offline' USING ERRCODE='23514'; END IF;
    PERFORM public._assert_pos_credit_v1(p_customer_id,p_order_id,v_total-v_pay_sum);
  END IF;
  PERFORM public.check_fiscal_period_open(current_date);
  -- Nouvelles lignes générées seulement après la validation du règlement.
  FOR v_gift IN SELECT * FROM jsonb_array_elements(public._payment_gift_items_v1(v_server_eval, p_promotions)) LOOP
    -- Un cadeau historique préparé ou annulé reste un fait : jamais recréé.
    SELECT COALESCE(sum(quantity), 0) INTO v_existing_gift_qty FROM public.order_items
      WHERE order_id = p_order_id AND is_promo_gift
        AND promotion_id = (v_gift->>'promotion_id')::uuid
        AND product_id = (v_gift->>'product_id')::uuid;
    v_gift_qty := GREATEST((v_gift->>'quantity')::numeric - v_existing_gift_qty, 0);
    IF v_gift_qty = 0 THEN CONTINUE; END IF;
    PERFORM public._assert_payment_gift_eligible_v1((v_gift->>'product_id')::uuid);
    v_gift_stations := public._resolve_dispatch_stations_v1((v_gift->>'product_id')::uuid);
    INSERT INTO public.order_items (order_id, product_id, name_snapshot, unit_price, quantity,
      line_total, modifiers, modifiers_total, dispatch_station, dispatch_stations,
      is_promo_gift, promotion_id, is_locked, kitchen_status, sent_to_kitchen_at)
    SELECT p_order_id, p.id, p.name, 0, v_gift_qty, 0, '[]'::jsonb, 0,
      v_gift_stations[1], v_gift_stations, true, (v_gift->>'promotion_id')::uuid,
      true, 'pending', now() FROM public.products p WHERE p.id = (v_gift->>'product_id')::uuid;
  END LOOP;
  FOR v_item IN     SELECT oi.product_id, oi.quantity, oi.combo_components, oi.modifier_ingredients_deducted,            p.name, p.current_stock, p.unit, p.is_display_item, p.product_type,
           COALESCE(p.track_inventory, true) AS track_inventory,            COALESCE(p.deduct_stock, false)  AS deduct_stock       FROM order_items oi
      JOIN products p ON p.id = oi.product_id       WHERE oi.order_id = p_order_id         AND oi.is_cancelled = false
      FOR UPDATE OF p   LOOP     IF v_item.product_type = 'combo' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.combo_components, '[]'::jsonb)) LOOP         v_comp_qty := (v_comp->>'quantity')::DECIMAL * v_item.quantity;         -- Audit lot 2 P0-5 : miroir de la branche non-combo ci-dessous.
        SELECT * INTO v_cmp FROM products WHERE id = (v_comp->>'product_id')::UUID;         IF v_cmp.is_display_item OR COALESCE(v_cmp.track_inventory, true) THEN           PERFORM _record_sale_stock_v1(
            p_product_id     := v_cmp.id,             p_quantity       := v_comp_qty,             p_reference_id   := p_order_id,
            p_created_by     := v_profile_id,             p_reason         := 'POS combo sale (pay existing)',             p_unit           := v_cmp.unit,
            p_allow_negative := v_allow_negative           );         ELSIF COALESCE(v_cmp.deduct_stock, false) THEN
          FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v2(v_cmp.id, v_comp_qty) LOOP             PERFORM _record_sale_stock_v1(               p_product_id     := v_cons.product_id,
              p_quantity       := v_cons.qty_base,               p_reference_id   := p_order_id,               p_created_by     := v_profile_id,
              p_reason         := 'POS combo recipe consumption (pay existing)',               p_unit           := v_cons.unit,               p_allow_negative := v_allow_negative
            );           END LOOP;         END IF;
      END LOOP;     ELSE       -- Bug 2026-08-25 : miroir de complete_order_with_payment. Un produit
      -- suivi (ou en vitrine) vend son propre stock ; un fini non suivi avec
      -- deduct_stock consomme sa recette (_resolve_recipe_consumption_v2,
      -- descente ADR-016 : stop au premier intermediaire stocke) ; sans
      -- deduct_stock, aucune deduction.
      IF v_item.is_display_item OR v_item.track_inventory THEN         PERFORM _record_sale_stock_v1(           p_product_id     := v_item.product_id,
          p_quantity       := v_item.quantity,           p_reference_id   := p_order_id,           p_created_by     := v_profile_id,
          p_reason         := 'POS sale (pay existing)',           p_unit           := v_item.unit,           p_allow_negative := v_allow_negative
        );       ELSIF v_item.deduct_stock THEN         FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v2(v_item.product_id, v_item.quantity) LOOP
          PERFORM _record_sale_stock_v1(             p_product_id     := v_cons.product_id,             p_quantity       := v_cons.qty_base,
            p_reference_id   := p_order_id,             p_created_by     := v_profile_id,             p_reason         := 'POS recipe consumption (pay existing)',
            p_unit           := v_cons.unit,             p_allow_negative := v_allow_negative           );
        END LOOP;       END IF;     END IF;
     IF v_item.modifier_ingredients_deducted IS NOT NULL THEN       FOR v_ing IN
        SELECT * FROM jsonb_to_recordset(v_item.modifier_ingredients_deducted)           AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)       LOOP
        PERFORM _record_sale_stock_v1(           p_product_id     := v_ing.product_id,           p_quantity       := v_ing.qty_base,
          p_reference_id   := p_order_id,           p_created_by     := v_profile_id,           p_reason         := 'POS modifier (pay existing): ' || v_ing.group_name || ' / ' || v_ing.option_label,
          p_unit           := v_ing.unit,           p_allow_negative := v_allow_negative         );
      END LOOP;     END IF;   END LOOP;
   UPDATE orders SET     customer_id               = p_customer_id,
    loyalty_points_redeemed   = p_loyalty_points_redeemed,     loyalty_redemption_amount = v_redemption_amount,     subtotal                  = v_items_total,
    tax_amount                = v_tax_amount,     total                     = v_total,     idempotency_key           = p_idempotency_key,
    served_by                 = v_profile_id,     discount_amount           = p_discount_amount,     discount_type             = p_discount_type,
    discount_value            = p_discount_value,     discount_reason           = p_discount_reason,     discount_authorized_by    = p_discount_authorized_by,
    promotion_total           = v_promotion_total,     updated_at                = now()     WHERE id = p_order_id;
   IF p_discount_amount > 0 THEN     INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.discount_applied', 'orders', p_order_id, jsonb_build_object(         'order_number',          v_order.order_number,         'order_discount_amount', p_discount_amount,
        'discount_type',         p_discount_type,         'discount_value',        p_discount_value,         'discount_reason',       p_discount_reason,
        'authorized_by',         p_discount_authorized_by,         'pin_gated',             (NOT p_offline_replay),         'offline_replay',        p_offline_replay,
        'rpc_version',           'v21-recipe-units'       ));   END IF;
   IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN     FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
      v_promo_id := (v_promo->>'promotion_id')::UUID;        PERFORM pg_advisory_xact_lock(hashtext(v_promo_id::text));
       SELECT max_uses, max_uses_per_customer         INTO v_cap_max_uses, v_cap_max_per_customer
        FROM promotions WHERE id = v_promo_id;        IF v_cap_max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_uses_global           FROM promotion_applications pa           JOIN orders o ON o.id = pa.order_id
          WHERE pa.promotion_id = v_promo_id AND o.voided_at IS NULL;         IF v_uses_global >= v_cap_max_uses THEN           RAISE EXCEPTION 'promo_cap_exceeded: promotion % has reached its global usage limit (%)',
            v_promo_id, v_cap_max_uses USING ERRCODE = 'check_violation';         END IF;       END IF;
       IF v_cap_max_per_customer IS NOT NULL AND p_customer_id IS NOT NULL THEN         SELECT count(*) INTO v_uses_customer
          FROM promotion_applications pa           JOIN orders o ON o.id = pa.order_id           WHERE pa.promotion_id = v_promo_id
            AND o.customer_id = p_customer_id             AND o.voided_at IS NULL;         IF v_uses_customer >= v_cap_max_per_customer THEN
          RAISE EXCEPTION 'promo_cap_exceeded: promotion % has reached its per-customer usage limit (%)',             v_promo_id, v_cap_max_per_customer USING ERRCODE = 'check_violation';         END IF;
      END IF;        INSERT INTO promotion_applications (order_id, promotion_id, amount, description)
      VALUES (         p_order_id,         v_promo_id,
        (v_promo->>'amount')::DECIMAL(14,2),         COALESCE(v_promo->>'description', '')       );
    END LOOP;   END IF; 
  FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP     INSERT INTO order_payments (       order_id, method, amount, cash_received, change_given, reference
    ) VALUES (       p_order_id,       (v_payment_entry->>'method')::payment_method,
      (v_payment_entry->>'amount')::DECIMAL(14,2),       NULLIF(v_payment_entry->>'cash_received','')::DECIMAL(14,2),       NULLIF(v_payment_entry->>'change_given','')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'reference','')     );   END LOOP;
   IF p_outstanding AND v_pay_sum < v_total THEN
    UPDATE orders SET outstanding_at=now(), status=CASE WHEN created_via='tablet' THEN 'draft'::order_status ELSE 'pending_payment'::order_status END,
      updated_at=now() WHERE id=p_order_id;
    PERFORM public._post_pos_outstanding_v1(p_order_id,v_profile_id);
  ELSE
    UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = p_order_id;
  END IF;
   -- ADR-013 Lot 4 (D8) : debit du ledger d'avoir -- une seule ligne spend par
  -- commande (ux_scl_spend_per_order). Place apres la claim d'idempotence :
  -- un replay court-circuite bien avant et ne re-debite jamais.
  -- NB : p_offline_replay ne bypasse PAS le gate D8 (un solde d'avoir ne peut
  -- pas etre vrai hors-ligne ; le CHECK >= 0 echouerait de toute facon).
  IF v_sc_amount > 0 THEN     PERFORM _apply_store_credit_v1(p_customer_id, -v_sc_amount, 'spend',               'orders', p_order_id, NULL, v_profile_id, NULL);
  END IF;    IF v_redemption_amount > 0 THEN
    SELECT id INTO v_je_id       FROM journal_entries       WHERE reference_type = 'sale' AND reference_id = p_order_id;
     v_loyalty_liab_id  := resolve_mapping_account('LOYALTY_LIABILITY');     v_sale_discount_id := resolve_mapping_account('SALE_DISCOUNT');
     IF v_je_id IS NOT NULL THEN       INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_loyalty_liab_id, v_redemption_amount, 0,                   'Loyalty redemption — DR liability'),         (v_je_id, v_sale_discount_id, 0,                  v_redemption_amount, 'Loyalty redemption — CR discount'); 
      UPDATE journal_entries         SET total_debit  = total_debit  + v_redemption_amount,             total_credit = total_credit + v_redemption_amount
        WHERE id = v_je_id;     END IF;   END IF;
   IF p_loyalty_points_redeemed > 0 THEN     UPDATE customers
      SET loyalty_points = loyalty_points - p_loyalty_points_redeemed,           updated_at     = now()       WHERE id = p_customer_id;
     INSERT INTO loyalty_transactions (       customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by     ) VALUES (       p_customer_id, p_order_id, 'redeem', -p_loyalty_points_redeemed,
      v_loyalty_balance - p_loyalty_points_redeemed,       'Redemption on order ' || p_order_id::text, v_profile_id     );
  END IF;    IF p_customer_id IS NOT NULL AND v_total > 0 THEN
    SELECT get_loyalty_multiplier(c.lifetime_points) * COALESCE(cc.points_multiplier, 1.0)       INTO v_loyalty_multiplier       FROM customers c
      LEFT JOIN customer_categories cc ON cc.id = c.category_id       WHERE c.id = p_customer_id         -- ADR-020 dec. 5 : la fidelite est un dispositif RETAIL, et la categorie
        -- peut la desactiver. Hors de ce cadre, aucun point n'est acquis.
        -- Un client sans categorie garde ses points : aucune categorie ne dit
        -- « desactive » pour lui.
        AND c.customer_type = 'retail'         AND COALESCE(cc.loyalty_enabled, true);     -- Aucune ligne ramenee = hors perimetre fidelite. Le repli passe de 1.0 a 0 :
    -- v_points_earned tombe a 0 et la branche ELSE existante tient les compteurs
    -- (total_spent, total_visits, last_visit_at) sans crediter de points.
    v_loyalty_multiplier := COALESCE(v_loyalty_multiplier, 0);      v_points_earned := FLOOR(v_total * v_loyalty_multiplier / 1000);
     IF v_points_earned > 0 THEN       UPDATE customers SET
        loyalty_points  = loyalty_points  + v_points_earned,         lifetime_points = lifetime_points + v_points_earned,         total_spent     = total_spent     + v_total,
        total_visits    = total_visits    + 1,         last_visit_at   = now(),         updated_at      = now()
      WHERE id = p_customer_id;        INSERT INTO loyalty_transactions (
        customer_id, order_id, transaction_type, points,         points_balance_after, order_amount, description, created_by       ) VALUES (
        p_customer_id, p_order_id, 'earn', v_points_earned,         (SELECT loyalty_points FROM customers WHERE id = p_customer_id),         v_total, 'Earned on order ' || p_order_id::text, v_profile_id
      );        UPDATE orders SET loyalty_points_earned = v_points_earned WHERE id = p_order_id;
    ELSE       UPDATE customers SET         total_spent  = total_spent + v_total,
        total_visits = total_visits + 1,         last_visit_at = now(),         updated_at    = now()
      WHERE id = p_customer_id;     END IF;   END IF;
   UPDATE public.orders SET recipe_consumption_revision=2 WHERE id=p_order_id;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)     VALUES (v_profile_id, 'order.pay_existing', 'orders', p_order_id, jsonb_build_object(
      'order_number',    v_order.order_number,       'items_total',     v_items_total,       'total',           v_total,
      'redemption',      v_redemption_amount,       'discount_amount', p_discount_amount,       'promotion_total', v_promotion_total,
      'tender_count',    v_pay_count,       'payment_methods', (SELECT jsonb_agg(DISTINCT op.method::TEXT)                           FROM order_payments op WHERE op.order_id = p_order_id),
      'offline_replay',  p_offline_replay,       'rpc_version',     'v21-recipe-units'     ));
   RETURN jsonb_build_object('order_id', p_order_id,
    'order_snapshot', public._pos_order_snapshot_data_v1(p_order_id),
    'order_number',            v_order.order_number,     'subtotal',                v_items_total,     'tax_amount',              v_tax_amount,
    'total',                   v_total,     'change_given',            v_total_change,     'loyalty_points_earned',   v_points_earned,
    'idempotent_replay',       false   ); END $function$
$body1$)
 ) AS source(signature,expected_md5,definition) LOOP
  v_function:=to_regprocedure(f.signature);
  IF v_function IS NULL THEN
   EXECUTE f.definition;
   v_function:=to_regprocedure(f.signature);
  END IF;
  IF v_function IS NULL OR md5(pg_get_functiondef(v_function))<>f.expected_md5 THEN
   RAISE EXCEPTION 'antifraud_native_definition_mismatch: %',f.signature;
  END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function);
 END LOOP;
END $bootstrap$;
