-- Session 27 / Wave 1.A.3 — update_product_v1 SECURITY DEFINER JSONB patch RPC.
CREATE OR REPLACE FUNCTION update_product_v1(
  p_product_id UUID,
  p_patch      JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_allowed_fields CONSTANT TEXT[] := ARRAY[
    'name', 'sku', 'category_id', 'description',
    'retail_price', 'wholesale_price',
    'tax_inclusive', 'image_url',
    'is_active', 'is_favorite', 'is_semi_finished',
    'visible_on_pos', 'available_for_sale', 'track_inventory', 'deduct_stock',
    'min_stock_threshold', 'target_gross_margin_pct', 'default_shelf_life_hours'
  ];
  v_key            TEXT;
  v_ignored_fields TEXT[] := ARRAY[]::TEXT[];
  v_product        products%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed_fields)) THEN
      v_ignored_fields := array_append(v_ignored_fields, v_key);
    END IF;
  END LOOP;

  UPDATE products SET
    name                     = COALESCE((p_patch->>'name')::TEXT, name),
    sku                      = COALESCE((p_patch->>'sku')::TEXT, sku),
    category_id              = COALESCE((p_patch->>'category_id')::UUID, category_id),
    description              = COALESCE((p_patch->>'description')::TEXT, description),
    retail_price             = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
    wholesale_price          = COALESCE((p_patch->>'wholesale_price')::NUMERIC, wholesale_price),
    tax_inclusive            = COALESCE((p_patch->>'tax_inclusive')::BOOLEAN, tax_inclusive),
    image_url                = COALESCE((p_patch->>'image_url')::TEXT, image_url),
    is_active                = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    is_favorite              = COALESCE((p_patch->>'is_favorite')::BOOLEAN, is_favorite),
    is_semi_finished         = COALESCE((p_patch->>'is_semi_finished')::BOOLEAN, is_semi_finished),
    visible_on_pos           = COALESCE((p_patch->>'visible_on_pos')::BOOLEAN, visible_on_pos),
    available_for_sale       = COALESCE((p_patch->>'available_for_sale')::BOOLEAN, available_for_sale),
    track_inventory          = COALESCE((p_patch->>'track_inventory')::BOOLEAN, track_inventory),
    deduct_stock             = COALESCE((p_patch->>'deduct_stock')::BOOLEAN, deduct_stock),
    min_stock_threshold      = COALESCE((p_patch->>'min_stock_threshold')::NUMERIC, min_stock_threshold),
    target_gross_margin_pct  = COALESCE((p_patch->>'target_gross_margin_pct')::NUMERIC, target_gross_margin_pct),
    default_shelf_life_hours = COALESCE((p_patch->>'default_shelf_life_hours')::INTEGER, default_shelf_life_hours),
    updated_at               = now()
  WHERE id = p_product_id
  RETURNING * INTO v_product;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
  VALUES (
    v_caller_id,
    'product.update',
    'product',
    p_product_id,
    p_patch,
    jsonb_build_object('ignored_fields', v_ignored_fields)
  );

  RETURN jsonb_build_object(
    'product',        to_jsonb(v_product),
    'ignored_fields', to_jsonb(v_ignored_fields)
  );
END;
$$;

COMMENT ON FUNCTION update_product_v1(UUID, JSONB) IS
  'Session 27 Wave 1.A.3: JSONB patch update for products. 18-col allowlist; cost_price excluded (use update_cost_price_v1). Returns {product, ignored_fields}. SECURITY DEFINER, perm gate products.update.';
