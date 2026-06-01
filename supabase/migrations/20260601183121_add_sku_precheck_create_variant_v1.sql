-- 20260601183121_add_sku_precheck_create_variant_v1.sql
-- Audit fix M8 (2026-06-01) — create_variant_v1 had no SKU pre-check; it relied on
-- the raw products.sku GLOBAL UNIQUE constraint raising 23505, so AddVariantDialog's
-- friendly 'sku_taken' mapping never fired. Add a pre-check matching
-- convert_product_to_parent_v1 / create_product_v1. The check is NOT filtered on
-- deleted_at because the constraint is global (not partial). CREATE OR REPLACE
-- (signature unchanged → existing REVOKE/GRANT ACL preserved).

CREATE OR REPLACE FUNCTION create_variant_v1(
  p_parent_id      UUID,
  p_variant_label  TEXT,
  p_sku            TEXT,
  p_retail_price   NUMERIC,
  p_cost_price     NUMERIC DEFAULT NULL,
  p_unit           TEXT    DEFAULT NULL,
  p_sort_order     INTEGER DEFAULT NULL,
  p_name           TEXT    DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_parent     RECORD;
  v_new_id     UUID := gen_random_uuid();
  v_sort       INTEGER;
  v_name       TEXT;
  v_axis       variant_axis_type;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_parent FROM products WHERE id = p_parent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parent_not_found: %', p_parent_id USING ERRCODE = 'P0002';
  END IF;

  IF v_parent.parent_product_id IS NOT NULL THEN
    RAISE EXCEPTION 'parent_is_variant: cannot add variant to a variant' USING ERRCODE = 'P0004';
  END IF;

  -- variant_axis is stored on siblings (parent has variant_axis NULL per XOR check).
  SELECT variant_axis INTO v_axis
    FROM products
   WHERE parent_product_id = p_parent_id AND deleted_at IS NULL
   LIMIT 1;

  IF v_axis IS NULL THEN
    RAISE EXCEPTION 'parent_has_no_variants: use convert_product_to_parent_v1 first' USING ERRCODE = 'P0004';
  END IF;

  -- M8 audit fix: SKU pre-check (products.sku is GLOBAL UNIQUE, not partial on
  -- deleted_at) → clean 'sku_taken' instead of the raw 23505 constraint text.
  IF p_sku IS NULL OR btrim(p_sku) = '' THEN
    RAISE EXCEPTION 'sku_required' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE sku = p_sku) THEN
    RAISE EXCEPTION 'sku_taken: %', p_sku USING ERRCODE = 'P0004';
  END IF;

  IF p_sort_order IS NULL THEN
    SELECT COALESCE(MAX(variant_sort_order), 0) + 10 INTO v_sort
      FROM products WHERE parent_product_id = p_parent_id AND deleted_at IS NULL;
  ELSE
    v_sort := p_sort_order;
  END IF;

  v_name := COALESCE(p_name, v_parent.name || ' ' || p_variant_label);

  INSERT INTO products (
    id, name, sku, category_id, unit,
    retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, description, created_at, updated_at,
    parent_product_id, variant_label, variant_axis, variant_sort_order
  )
  VALUES (
    v_new_id,
    v_name,
    p_sku,
    v_parent.category_id,
    COALESCE(p_unit, v_parent.unit),
    p_retail_price,
    COALESCE(p_cost_price, 0),
    v_parent.visible_on_pos,
    v_parent.available_for_sale,
    v_parent.track_inventory,
    v_parent.deduct_stock,
    true,
    v_parent.description,
    now(), now(),
    p_parent_id,
    p_variant_label,
    v_axis,
    v_sort
  );

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user_id,
    'products.variant.created',
    'product',
    v_new_id,
    jsonb_build_object(
      'parent_id', p_parent_id,
      'variant_label', p_variant_label,
      'sku', p_sku,
      'retail_price', p_retail_price
    )
  );

  RETURN v_new_id;
END;
$$;
