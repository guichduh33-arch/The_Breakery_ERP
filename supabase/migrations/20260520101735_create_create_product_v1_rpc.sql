-- Session 27b / Phase 1 — create_product_v1 SECURITY DEFINER JSONB payload RPC.
-- Required: name, sku, category_id. SKU uniqueness check. perm products.create.
CREATE OR REPLACE FUNCTION create_product_v1(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_allowed     CONSTANT TEXT[] := ARRAY[
    'name','sku','category_id','description',
    'retail_price','wholesale_price','cost_price',
    'tax_inclusive','image_url',
    'is_active','is_favorite','is_semi_finished',
    'visible_on_pos','available_for_sale','track_inventory','deduct_stock',
    'min_stock_threshold','target_gross_margin_pct','default_shelf_life_hours',
    'product_type','unit'
  ];
  v_key         TEXT;
  v_ignored     TEXT[] := ARRAY[]::TEXT[];
  v_name        TEXT;
  v_sku         TEXT;
  v_category_id UUID;
  v_retail      NUMERIC;
  v_unit        TEXT;
  v_id          UUID;
  v_row         products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.create') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_payload)
  LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      v_ignored := array_append(v_ignored, v_key);
    END IF;
  END LOOP;

  v_name        := NULLIF(trim(p_payload->>'name'), '');
  v_sku         := NULLIF(trim(p_payload->>'sku'), '');
  v_category_id := NULLIF(p_payload->>'category_id', '')::UUID;
  v_retail      := COALESCE((p_payload->>'retail_price')::NUMERIC, 0);
  v_unit        := COALESCE(NULLIF(trim(p_payload->>'unit'), ''), 'pcs');

  IF v_name IS NULL OR v_sku IS NULL OR v_category_id IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields'
      USING ERRCODE = '22023',
            HINT = 'name, sku and category_id are required';
  END IF;

  IF v_retail < 0 THEN
    RAISE EXCEPTION 'invalid_retail_price'
      USING ERRCODE = '22023',
            HINT = 'retail_price must be >= 0';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = v_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (SELECT 1 FROM products WHERE sku = v_sku AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'sku_taken'
      USING ERRCODE = '23505',
            HINT = format('A product with sku=%s already exists', v_sku);
  END IF;

  INSERT INTO products (
    sku, name, category_id, description,
    retail_price, wholesale_price, cost_price,
    tax_inclusive, image_url,
    is_active, is_favorite, is_semi_finished,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    min_stock_threshold, target_gross_margin_pct, default_shelf_life_hours,
    product_type, unit
  ) VALUES (
    v_sku,
    v_name,
    v_category_id,
    p_payload->>'description',
    v_retail,
    NULLIF(p_payload->>'wholesale_price','')::NUMERIC,
    COALESCE((p_payload->>'cost_price')::NUMERIC, 0),
    COALESCE((p_payload->>'tax_inclusive')::BOOLEAN, true),
    p_payload->>'image_url',
    COALESCE((p_payload->>'is_active')::BOOLEAN, true),
    COALESCE((p_payload->>'is_favorite')::BOOLEAN, false),
    COALESCE((p_payload->>'is_semi_finished')::BOOLEAN, false),
    COALESCE((p_payload->>'visible_on_pos')::BOOLEAN, true),
    COALESCE((p_payload->>'available_for_sale')::BOOLEAN, true),
    COALESCE((p_payload->>'track_inventory')::BOOLEAN, true),
    COALESCE((p_payload->>'deduct_stock')::BOOLEAN, true),
    COALESCE((p_payload->>'min_stock_threshold')::NUMERIC, 0),
    NULLIF(p_payload->>'target_gross_margin_pct','')::NUMERIC,
    NULLIF(p_payload->>'default_shelf_life_hours','')::INTEGER,
    COALESCE(NULLIF(p_payload->>'product_type',''), 'finished'),
    v_unit
  )
  RETURNING * INTO v_row;
  v_id := v_row.id;

  -- Seed product_unit_contexts with base unit for all 4 contexts (mirrors
  -- the S27 catch-up _022442 seed for existing products).
  INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
  VALUES (v_id, v_unit, v_unit, v_unit, v_unit)
  ON CONFLICT (product_id) DO NOTHING;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
  VALUES (
    v_caller_id,
    'product.create',
    'product',
    v_id,
    p_payload,
    jsonb_build_object('ignored_fields', v_ignored)
  );

  RETURN jsonb_build_object(
    'product',        to_jsonb(v_row),
    'ignored_fields', to_jsonb(v_ignored)
  );
END;
$$;

COMMENT ON FUNCTION create_product_v1(JSONB) IS
  'Session 27b — Create a product from JSONB payload. Required: name, sku, category_id. SKU uniqueness enforced (raises 23505 sku_taken). SECURITY DEFINER + perm products.create. Seeds product_unit_contexts with base unit.';
