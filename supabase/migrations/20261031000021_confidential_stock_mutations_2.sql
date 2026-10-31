-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.set_product_base_unit_v2(p_product_id uuid, p_new_unit text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id      UUID := auth.uid();
  v_old_unit       TEXT;
  v_stock          NUMERIC;
  v_cost           NUMERIC;
  v_movements      INT;
  v_display        NUMERIC;
  v_new            TEXT := btrim(p_new_unit);
  v_factor         NUMERIC;
  v_cost_converted BOOLEAN := FALSE;
  v_new_cost       NUMERIC;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.units.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF v_new IS NULL OR v_new = '' THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE = '22023';
  END IF;

  SELECT unit, COALESCE(current_stock, 0), cost_price
    INTO v_old_unit, v_stock, v_cost
    FROM products
   WHERE id = p_product_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_old_unit IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_new = v_old_unit THEN
    RAISE EXCEPTION 'unit_unchanged' USING ERRCODE = 'P0001';
  END IF;

  -- Safety guard: nothing recorded against the old unit may exist.
  SELECT count(*)            INTO v_movements FROM stock_movements WHERE product_id = p_product_id;
  SELECT COALESCE(SUM(quantity), 0) INTO v_display FROM display_stock   WHERE product_id = p_product_id;
  IF v_stock <> 0 OR v_movements > 0 OR v_display <> 0 THEN
    RAISE EXCEPTION 'base_unit_change_requires_zero_stock'
      USING ERRCODE = 'P0001',
            DETAIL  = format('stock=%s movements=%s display=%s', v_stock, v_movements, v_display),
            HINT    = 'Zero out stock and ensure no stock movements before changing the base unit.';
  END IF;

  -- Convert cost_price when a global conversion old→new exists; otherwise leave it.
  -- cost per new unit = cost per old unit × (old units per 1 new unit).
  IF v_cost IS NOT NULL AND v_cost <> 0 THEN
    BEGIN
      v_factor   := public.convert_quantity(1, v_new, v_old_unit);
      v_new_cost := v_cost * v_factor;
      v_cost_converted := TRUE;
    EXCEPTION WHEN OTHERS THEN
      v_cost_converted := FALSE;
    END;
  END IF;

  UPDATE products
     SET unit       = v_new,
         cost_price = CASE WHEN v_cost_converted THEN v_new_cost ELSE cost_price END,
         updated_at = now()
   WHERE id = p_product_id;

  -- Reset units defined against the old base.
  UPDATE product_unit_alternatives
     SET deleted_at = now(), updated_at = now()
   WHERE product_id = p_product_id AND deleted_at IS NULL;
  DELETE FROM product_unit_contexts WHERE product_id = p_product_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_actor_profile, 'product.base_unit_changed', 'product', p_product_id,
          jsonb_build_object('from', v_old_unit, 'to', v_new,
                             'cost_price_converted', v_cost_converted));

  RETURN jsonb_build_object(
    'product_id',            p_product_id,
    'old_unit',             v_old_unit,
    'new_unit',             v_new,
    'cost_price_converted', v_cost_converted
  );
END $function$
;
REVOKE ALL ON FUNCTION stock_private.set_product_base_unit_v2(p_product_id uuid, p_new_unit text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.set_product_base_unit_v3(p_product_id uuid, p_new_unit text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.set_product_base_unit_v2(p_product_id,p_new_unit));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.set_product_base_unit_v2(p_product_id uuid, p_new_unit text);
REVOKE ALL ON FUNCTION public.set_product_base_unit_v3(p_product_id uuid, p_new_unit text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_product_base_unit_v3(p_product_id uuid, p_new_unit text) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.create_product_v3(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id CONSTANT UUID := auth.uid();
  -- Lot 6b : 'tax_inclusive' retiré (flag produit déprécié — le mode fiscal
  -- est global, business_config.tax_inclusive ; la colonne garde son DEFAULT).
  v_allowed   CONSTANT TEXT[] := ARRAY[
    'name','sku','category_id','description',
    'retail_price','wholesale_price','cost_price',
    'image_url',
    'is_active','is_favorite','is_semi_finished',
    'visible_on_pos','available_for_sale','track_inventory','deduct_stock',
    'is_display_item','dispatch_stations',
    'min_stock_threshold','target_gross_margin_pct','default_shelf_life_hours',
    'product_type','unit'
  ];
  v_key TEXT; v_ignored TEXT[] := ARRAY[]::TEXT[];
  v_name TEXT; v_sku TEXT; v_category_id UUID; v_retail NUMERIC; v_unit TEXT; v_id UUID; v_row products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.create') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN v_ignored := array_append(v_ignored, v_key); END IF;
  END LOOP;
  v_name := NULLIF(trim(p_payload->>'name'), '');
  v_sku  := NULLIF(trim(p_payload->>'sku'), '');
  v_category_id := NULLIF(p_payload->>'category_id', '')::UUID;
  v_retail := COALESCE((p_payload->>'retail_price')::NUMERIC, 0);
  v_unit := COALESCE(NULLIF(trim(p_payload->>'unit'), ''), 'pcs');
  IF v_name IS NULL OR v_sku IS NULL OR v_category_id IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE='22023', HINT='name, sku and category_id are required';
  END IF;
  IF v_retail < 0 THEN
    RAISE EXCEPTION 'invalid_retail_price' USING ERRCODE='22023', HINT='retail_price must be >= 0';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = v_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE='P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE sku = v_sku AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'sku_taken' USING ERRCODE='23505', HINT=format('A product with sku=%s already exists', v_sku);
  END IF;
  INSERT INTO products (
    sku, name, category_id, description,
    retail_price, wholesale_price, cost_price,
    image_url,
    is_active, is_favorite, is_semi_finished,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_display_item, dispatch_stations,
    min_stock_threshold, target_gross_margin_pct, default_shelf_life_hours,
    product_type, unit
  ) VALUES (
    v_sku, v_name, v_category_id, p_payload->>'description',
    v_retail, NULLIF(p_payload->>'wholesale_price','')::NUMERIC, COALESCE((p_payload->>'cost_price')::NUMERIC, 0),
    p_payload->>'image_url',
    COALESCE((p_payload->>'is_active')::BOOLEAN, true), COALESCE((p_payload->>'is_favorite')::BOOLEAN, false),
    COALESCE((p_payload->>'is_semi_finished')::BOOLEAN, false),
    COALESCE((p_payload->>'visible_on_pos')::BOOLEAN, true), COALESCE((p_payload->>'available_for_sale')::BOOLEAN, true),
    COALESCE((p_payload->>'track_inventory')::BOOLEAN, true), COALESCE((p_payload->>'deduct_stock')::BOOLEAN, true),
    COALESCE((p_payload->>'is_display_item')::BOOLEAN, false),
    CASE WHEN jsonb_typeof(p_payload->'dispatch_stations') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(p_payload->'dispatch_stations'))
         ELSE NULL END,
    COALESCE((p_payload->>'min_stock_threshold')::NUMERIC, 0),
    NULLIF(p_payload->>'target_gross_margin_pct','')::NUMERIC, NULLIF(p_payload->>'default_shelf_life_hours','')::INTEGER,
    COALESCE(NULLIF(p_payload->>'product_type',''), 'finished'), v_unit
  ) RETURNING * INTO v_row;
  v_id := v_row.id;
  INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
    VALUES (v_id, v_unit, v_unit, v_unit, v_unit) ON CONFLICT (product_id) DO NOTHING;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, 'product.create', 'product', v_id, p_payload, jsonb_build_object('ignored_fields', v_ignored));
  RETURN jsonb_build_object('product', to_jsonb(v_row), 'ignored_fields', to_jsonb(v_ignored));
END $function$
;
REVOKE ALL ON FUNCTION stock_private.create_product_v3(p_payload jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.create_product_v4(p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.create_product_v3(p_payload));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.create_product_v3(p_payload jsonb);
REVOKE ALL ON FUNCTION public.create_product_v4(p_payload jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_product_v4(p_payload jsonb) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.get_b2b_invoice_v1(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_o     RECORD;
  v_cust  RECORD;
  v_terms INTEGER;
  v_paid  NUMERIC(14,2);
  v_lines JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'b2b.read') THEN
    RAISE EXCEPTION 'permission_denied: b2b.read' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, order_number, invoice_number, created_at, status,
         subtotal, tax_amount, total, notes, customer_id, order_type
    INTO v_o
    FROM orders WHERE id = p_order_id;
  IF v_o.id IS NULL OR v_o.order_type <> 'b2b' THEN
    RAISE EXCEPTION 'invoice_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT name, b2b_company_name, b2b_tax_id, phone, email,
         COALESCE(b2b_payment_terms_days, 0) AS terms
    INTO v_cust
    FROM customers WHERE id = v_o.customer_id;
  v_terms := COALESCE(v_cust.terms, 0);

  SELECT COALESCE(amount_paid, 0) INTO v_paid
    FROM view_b2b_invoices WHERE invoice_id = p_order_id;
  v_paid := COALESCE(v_paid, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name',       oi.name_snapshot,
           'quantity',   oi.quantity,
           'unit_price', oi.unit_price,
           'line_total', oi.line_total
         ) ORDER BY oi.id), '[]'::jsonb)
    INTO v_lines
    FROM order_items oi WHERE oi.order_id = p_order_id;

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object(
      'invoice_number', v_o.invoice_number,
      'order_number',   v_o.order_number,
      'invoice_date',   v_o.created_at::date,
      'due_date',       (v_o.created_at::date + (v_terms || ' days')::interval)::date,
      'status',         v_o.status,
      'subtotal',       v_o.subtotal,
      'tax_amount',     v_o.tax_amount,
      'total',          v_o.total,
      'notes',          v_o.notes
    ),
    'customer', jsonb_build_object(
      'company_name',       v_cust.b2b_company_name,
      'tax_id',             v_cust.b2b_tax_id,
      'name',               v_cust.name,
      'phone',              v_cust.phone,
      'email',              v_cust.email,
      'payment_terms_days', v_terms
    ),
    'lines',   v_lines,
    'payment', jsonb_build_object(
      'amount_paid', v_paid,
      'outstanding', GREATEST(v_o.total - v_paid, 0)
    )
  );
END $function$
;
REVOKE ALL ON FUNCTION stock_private.get_b2b_invoice_v1(p_order_id uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_b2b_invoice_v2(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 IF NOT public.can_view_order_v1(p_order_id) THEN RAISE EXCEPTION 'business_day_not_released' USING ERRCODE='P0003'; END IF;
 RETURN stock_private.mask_stock_payload(stock_private.get_b2b_invoice_v1(p_order_id));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.get_b2b_invoice_v1(p_order_id uuid);
REVOKE ALL ON FUNCTION public.get_b2b_invoice_v2(p_order_id uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_b2b_invoice_v2(p_order_id uuid) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.record_batch_production_v9(p_batch jsonb, p_items jsonb)
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
  FOR v_agg IN SELECT * FROM _batch_items ORDER BY item_idx LOOP     v_rec_result := record_production_v8(       p_product_id            := v_agg.product_id,
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
REVOKE ALL ON FUNCTION stock_private.record_batch_production_v9(p_batch jsonb, p_items jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_batch_production_v10(p_batch jsonb, p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.record_batch_production_v9(p_batch,p_items));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.record_batch_production_v9(p_batch jsonb, p_items jsonb);
REVOKE ALL ON FUNCTION public.record_batch_production_v10(p_batch jsonb, p_items jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_batch_production_v10(p_batch jsonb, p_items jsonb) TO authenticated;


