-- Session 27c / Wave 2.I corrective — convert_parent_to_standalone_v1 fixes partial-NULL on soft-deleted siblings.
-- Why : the previous bump (20260524005339) NULL-out only `parent_product_id` when detaching previously-
-- soft-deleted siblings before the parent DELETE. But `products_variant_xor` CHECK requires all 3 of
-- (parent_product_id, variant_label, variant_axis) to be either ALL NULL or ALL NOT NULL — so leaving
-- `variant_label` + `variant_axis` populated raises 23514 and aborts the dissolve transaction.
-- Fix : NULL out ALL THREE variant columns + reset variant_sort_order to 0 when detaching soft-deleted
-- siblings, in both the v_active_count = 1 and v_active_count = 0 branches. Ex-siblings remain soft-
-- deleted (is_active = false, deleted_at preserved) but are no longer variant-shaped and satisfy XOR.

CREATE OR REPLACE FUNCTION convert_parent_to_standalone_v1(p_parent_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_active_count INTEGER;
  v_variant_id   UUID;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_parent_id AND parent_product_id IS NULL) THEN
    RAISE EXCEPTION 'parent_not_found_or_is_variant' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO v_active_count
    FROM products WHERE parent_product_id = p_parent_id AND is_active = true AND deleted_at IS NULL;

  IF v_active_count > 1 THEN
    RAISE EXCEPTION 'multiple_variants_remaining: cannot dissolve parent with % active variants', v_active_count USING ERRCODE = 'P0004';
  END IF;

  IF v_active_count = 1 THEN
    SELECT id INTO v_variant_id
      FROM products WHERE parent_product_id = p_parent_id AND is_active = true AND deleted_at IS NULL;

    -- Flip the lone active variant into a standalone product : NULL-out all 3 variant cols.
    UPDATE products
       SET parent_product_id = NULL,
           variant_label     = NULL,
           variant_axis      = NULL,
           variant_sort_order = 0,
           updated_at        = now()
     WHERE id = v_variant_id;

    -- Detach any previously-soft-deleted siblings — NULL out ALL THREE variant cols + reset sort_order
    -- so they satisfy the products_variant_xor CHECK (the previous version only NULLed parent_product_id
    -- which left variant_label + variant_axis populated → 23514).
    UPDATE products
       SET parent_product_id = NULL,
           variant_label     = NULL,
           variant_axis      = NULL,
           variant_sort_order = 0,
           updated_at        = now()
     WHERE parent_product_id = p_parent_id;

    -- Hard delete the orphan parent (frees the "-PARENT" SKU for future conversions).
    DELETE FROM products WHERE id = p_parent_id;
  ELSE
    -- 0 active variants : detach any inactive siblings (NULL all 3 cols), then hard-delete the parent.
    UPDATE products
       SET parent_product_id = NULL,
           variant_label     = NULL,
           variant_axis      = NULL,
           variant_sort_order = 0,
           updated_at        = now()
     WHERE parent_product_id = p_parent_id;

    DELETE FROM products WHERE id = p_parent_id;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user_id,
    'products.variant.parent_dissolved',
    'product',
    p_parent_id,
    jsonb_build_object('promoted_variant_id', v_variant_id, 'remaining_active', v_active_count)
  );

  RETURN COALESCE(v_variant_id, p_parent_id);
END;
$$;
