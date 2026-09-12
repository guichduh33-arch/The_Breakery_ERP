-- Audit produits : un null explicite efface les champs optionnels ; une clé
-- absente préserve leur valeur. Corps dérivé de pg_get_functiondef live le 2026-09-11.
CREATE OR REPLACE FUNCTION public.update_product_v4(p_product_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id      UUID := auth.uid();
  -- Lot 6b : 'tax_inclusive' retiré (flag produit déprécié — le mode fiscal
  -- est global, business_config.tax_inclusive ; patch renvoyé en ignored_fields).
  v_allowed_fields CONSTANT TEXT[] := ARRAY[
    'name', 'sku', 'category_id', 'description',
    'retail_price', 'wholesale_price', 'image_url',
    'is_active', 'is_favorite', 'is_semi_finished',
    'visible_on_pos', 'available_for_sale', 'track_inventory', 'deduct_stock',
    'is_display_item', 'dispatch_stations',
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
  IF p_patch ? 'name' AND NULLIF(trim(p_patch->>'name'), '') IS NULL
     OR p_patch ? 'sku' AND NULLIF(trim(p_patch->>'sku'), '') IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields' USING ERRCODE='22023', HINT='name and sku must not be blank';
  END IF;
  IF p_patch ? 'retail_price' AND (
    p_patch->>'retail_price' IS NULL OR (p_patch->>'retail_price')::NUMERIC < 0
    OR (p_patch->>'retail_price')::NUMERIC::TEXT IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RAISE EXCEPTION 'invalid_retail_price' USING ERRCODE='22023', HINT='retail_price must be finite and >= 0';
  END IF;
  UPDATE products SET
    name = COALESCE((p_patch->>'name')::TEXT, name),
    sku = COALESCE((p_patch->>'sku')::TEXT, sku),
    category_id = COALESCE((p_patch->>'category_id')::UUID, category_id),
    description = CASE WHEN p_patch ? 'description' THEN (p_patch->>'description')::TEXT ELSE description END,
    retail_price = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
    wholesale_price = CASE WHEN p_patch ? 'wholesale_price' THEN (p_patch->>'wholesale_price')::NUMERIC ELSE wholesale_price END,
    image_url = CASE WHEN p_patch ? 'image_url' THEN (p_patch->>'image_url')::TEXT ELSE image_url END,
    is_active = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    is_favorite = COALESCE((p_patch->>'is_favorite')::BOOLEAN, is_favorite),
    is_semi_finished = COALESCE((p_patch->>'is_semi_finished')::BOOLEAN, is_semi_finished),
    visible_on_pos = COALESCE((p_patch->>'visible_on_pos')::BOOLEAN, visible_on_pos),
    available_for_sale = COALESCE((p_patch->>'available_for_sale')::BOOLEAN, available_for_sale),
    track_inventory = COALESCE((p_patch->>'track_inventory')::BOOLEAN, track_inventory),
    deduct_stock = COALESCE((p_patch->>'deduct_stock')::BOOLEAN, deduct_stock),
    is_display_item = COALESCE((p_patch->>'is_display_item')::BOOLEAN, is_display_item),
    -- Override multi-station : clé présente => pose (array) ou efface (null) ; absente => inchangé.
    dispatch_stations = CASE
      WHEN p_patch ? 'dispatch_stations'
      THEN (CASE WHEN jsonb_typeof(p_patch->'dispatch_stations') = 'array'
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'dispatch_stations'))
                 ELSE NULL END)
      ELSE dispatch_stations END,
    min_stock_threshold = COALESCE((p_patch->>'min_stock_threshold')::NUMERIC, min_stock_threshold),
    target_gross_margin_pct = CASE WHEN p_patch ? 'target_gross_margin_pct' THEN (p_patch->>'target_gross_margin_pct')::NUMERIC ELSE target_gross_margin_pct END,
    default_shelf_life_hours = CASE WHEN p_patch ? 'default_shelf_life_hours' THEN (p_patch->>'default_shelf_life_hours')::INTEGER ELSE default_shelf_life_hours END,
    updated_at = now()
  WHERE id = p_product_id RETURNING * INTO v_product;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
    VALUES (v_actor_profile, 'product.update', 'product', p_product_id, p_patch, jsonb_build_object('ignored_fields', v_ignored_fields));
  RETURN jsonb_build_object('product', to_jsonb(v_product), 'ignored_fields', to_jsonb(v_ignored_fields));
END $function$
;

REVOKE ALL ON FUNCTION public.update_product_v4(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_v4(uuid,jsonb) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.update_product_v3(uuid,jsonb);
