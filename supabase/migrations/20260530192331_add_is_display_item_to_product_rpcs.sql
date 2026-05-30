-- 20260530192331_add_is_display_item_to_product_rpcs.sql
-- Étend l'allowlist create_product_v1 + update_product_v1 avec is_display_item.
-- CREATE OR REPLACE (signatures inchangées) → pas de DROP, REVOKE pairs S27 préservées.

CREATE OR REPLACE FUNCTION public.create_product_v1(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id CONSTANT UUID := auth.uid();
  v_allowed   CONSTANT TEXT[] := ARRAY[
    'name','sku','category_id','description',
    'retail_price','wholesale_price','cost_price',
    'tax_inclusive','image_url',
    'is_active','is_favorite','is_semi_finished',
    'visible_on_pos','available_for_sale','track_inventory','deduct_stock',
    'is_display_item',
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
    tax_inclusive, image_url,
    is_active, is_favorite, is_semi_finished,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_display_item,
    min_stock_threshold, target_gross_margin_pct, default_shelf_life_hours,
    product_type, unit
  ) VALUES (
    v_sku, v_name, v_category_id, p_payload->>'description',
    v_retail, NULLIF(p_payload->>'wholesale_price','')::NUMERIC, COALESCE((p_payload->>'cost_price')::NUMERIC, 0),
    COALESCE((p_payload->>'tax_inclusive')::BOOLEAN, true), p_payload->>'image_url',
    COALESCE((p_payload->>'is_active')::BOOLEAN, true), COALESCE((p_payload->>'is_favorite')::BOOLEAN, false),
    COALESCE((p_payload->>'is_semi_finished')::BOOLEAN, false),
    COALESCE((p_payload->>'visible_on_pos')::BOOLEAN, true), COALESCE((p_payload->>'available_for_sale')::BOOLEAN, true),
    COALESCE((p_payload->>'track_inventory')::BOOLEAN, true), COALESCE((p_payload->>'deduct_stock')::BOOLEAN, true),
    COALESCE((p_payload->>'is_display_item')::BOOLEAN, false),
    COALESCE((p_payload->>'min_stock_threshold')::NUMERIC, 0),
    NULLIF(p_payload->>'target_gross_margin_pct','')::NUMERIC, NULLIF(p_payload->>'default_shelf_life_hours','')::INTEGER,
    COALESCE(NULLIF(p_payload->>'product_type',''), 'finished'), v_unit
  ) RETURNING * INTO v_row;
  v_id := v_row.id;
  INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
    VALUES (v_id, v_unit, v_unit, v_unit, v_unit) ON CONFLICT (product_id) DO NOTHING;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_caller_id, 'product.create', 'product', v_id, p_payload, jsonb_build_object('ignored_fields', v_ignored));
  RETURN jsonb_build_object('product', to_jsonb(v_row), 'ignored_fields', to_jsonb(v_ignored));
END $function$;

CREATE OR REPLACE FUNCTION public.update_product_v1(p_product_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_allowed_fields CONSTANT TEXT[] := ARRAY[
    'name', 'sku', 'category_id', 'description',
    'retail_price', 'wholesale_price', 'tax_inclusive', 'image_url',
    'is_active', 'is_favorite', 'is_semi_finished',
    'visible_on_pos', 'available_for_sale', 'track_inventory', 'deduct_stock',
    'is_display_item',
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
  UPDATE products SET
    name = COALESCE((p_patch->>'name')::TEXT, name),
    sku = COALESCE((p_patch->>'sku')::TEXT, sku),
    category_id = COALESCE((p_patch->>'category_id')::UUID, category_id),
    description = COALESCE((p_patch->>'description')::TEXT, description),
    retail_price = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
    wholesale_price = COALESCE((p_patch->>'wholesale_price')::NUMERIC, wholesale_price),
    tax_inclusive = COALESCE((p_patch->>'tax_inclusive')::BOOLEAN, tax_inclusive),
    image_url = COALESCE((p_patch->>'image_url')::TEXT, image_url),
    is_active = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    is_favorite = COALESCE((p_patch->>'is_favorite')::BOOLEAN, is_favorite),
    is_semi_finished = COALESCE((p_patch->>'is_semi_finished')::BOOLEAN, is_semi_finished),
    visible_on_pos = COALESCE((p_patch->>'visible_on_pos')::BOOLEAN, visible_on_pos),
    available_for_sale = COALESCE((p_patch->>'available_for_sale')::BOOLEAN, available_for_sale),
    track_inventory = COALESCE((p_patch->>'track_inventory')::BOOLEAN, track_inventory),
    deduct_stock = COALESCE((p_patch->>'deduct_stock')::BOOLEAN, deduct_stock),
    is_display_item = COALESCE((p_patch->>'is_display_item')::BOOLEAN, is_display_item),
    min_stock_threshold = COALESCE((p_patch->>'min_stock_threshold')::NUMERIC, min_stock_threshold),
    target_gross_margin_pct = COALESCE((p_patch->>'target_gross_margin_pct')::NUMERIC, target_gross_margin_pct),
    default_shelf_life_hours = COALESCE((p_patch->>'default_shelf_life_hours')::INTEGER, default_shelf_life_hours),
    updated_at = now()
  WHERE id = p_product_id RETURNING * INTO v_product;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_caller_id, 'product.update', 'product', p_product_id, p_patch, jsonb_build_object('ignored_fields', v_ignored_fields));
  RETURN jsonb_build_object('product', to_jsonb(v_product), 'ignored_fields', to_jsonb(v_ignored_fields));
END $function$;
