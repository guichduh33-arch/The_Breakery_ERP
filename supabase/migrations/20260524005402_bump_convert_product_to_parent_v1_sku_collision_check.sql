-- Session 27c / Wave 2 corrective — convert_product_to_parent_v1 pre-checks the candidate "-PARENT" SKU.
-- Why : products.sku is GLOBAL UNIQUE. If a tenant already has a product whose SKU ends with "-PARENT",
-- or (theoretical edge case post-corrective-1) any other source of collision, the INSERT would raise a
-- raw 23505 unique_violation. We pre-check and raise a clean P0004 with a descriptive message.

CREATE OR REPLACE FUNCTION convert_product_to_parent_v1(
  p_product_id          UUID,
  p_first_variant_label TEXT,
  p_variant_axis        variant_axis_type,
  p_first_variant_name  TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID;
  v_product    RECORD;
  v_parent_id  UUID := gen_random_uuid();
BEGIN
  v_user_id := auth.uid();

  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found: %', p_product_id USING ERRCODE = 'P0002';
  END IF;

  IF v_product.parent_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_variant: % is already a variant', p_product_id USING ERRCODE = 'P0004';
  END IF;

  IF EXISTS (SELECT 1 FROM products WHERE parent_product_id = p_product_id) THEN
    RAISE EXCEPTION 'already_parent: % is already a parent', p_product_id USING ERRCODE = 'P0004';
  END IF;

  IF p_first_variant_label IS NULL OR length(trim(p_first_variant_label)) = 0 THEN
    RAISE EXCEPTION 'invalid_label: first_variant_label is required' USING ERRCODE = 'P0004';
  END IF;

  -- Pre-check candidate parent SKU to surface a clean error instead of raw 23505.
  IF EXISTS (SELECT 1 FROM products WHERE sku = v_product.sku || '-PARENT') THEN
    RAISE EXCEPTION 'sku_collision: parent SKU % already exists', v_product.sku || '-PARENT'
      USING ERRCODE = 'P0004';
  END IF;

  -- DECISION : existing UUID becomes the FIRST VARIANT. A new parent product is inserted.
  -- Update existing product : set parent_product_id = NEW parent_uuid, variant_label, variant_axis.
  -- Existing FKs (stock, orders, recipes) still resolve via existing UUID = first variant.
  -- Parent product has no own stock / orders / recipe — it's a logical grouping only.

  INSERT INTO products (
    id, name, sku, category_id, unit, retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, description, created_at, updated_at,
    parent_product_id, variant_label, variant_axis
  )
  VALUES (
    v_parent_id,
    v_product.name,
    v_product.sku || '-PARENT',  -- avoid SKU collision
    v_product.category_id,
    v_product.unit,
    v_product.retail_price,
    0,                            -- parent has no own cost
    v_product.visible_on_pos,
    v_product.available_for_sale,
    false,                        -- parent has no own inventory
    false,
    v_product.is_active,
    v_product.description,
    now(), now(),
    NULL, NULL, NULL
  );

  -- Re-link the existing product as the first variant.
  UPDATE products
     SET parent_product_id  = v_parent_id,
         variant_label      = p_first_variant_label,
         variant_axis       = p_variant_axis,
         variant_sort_order = 10,
         name               = COALESCE(p_first_variant_name, v_product.name || ' ' || p_first_variant_label),
         updated_at         = now()
   WHERE id = p_product_id;

  -- Audit log row.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user_id,
    'products.variant.parent_created',
    'product',
    v_parent_id,
    jsonb_build_object(
      'parent_id',           v_parent_id,
      'first_variant_id',    p_product_id,
      'first_variant_label', p_first_variant_label,
      'variant_axis',        p_variant_axis,
      'name_preserved',      (p_first_variant_name IS NULL)
    )
  );

  RETURN v_parent_id;
END;
$$;

COMMENT ON FUNCTION convert_product_to_parent_v1 IS
  'Convert a standalone product into a parent+first-variant pair. Inserts a NEW parent product, re-links the existing UUID as the first variant. Existing FKs (stock_movements, order_items, recipes) continue to resolve to the variant, not the parent.';
