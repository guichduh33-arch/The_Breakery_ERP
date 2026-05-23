-- Session 27c / Wave 2 — Dissolve a parent : merges single remaining variant back into a standalone.
-- Inverse of convert_product_to_parent_v1.

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

    -- Flip the variant into a standalone product : NULL-out the 3 variant cols.
    UPDATE products
       SET parent_product_id = NULL,
           variant_label     = NULL,
           variant_axis      = NULL,
           variant_sort_order = 0,
           updated_at        = now()
     WHERE id = v_variant_id;

    -- Soft-delete the parent (no longer needed).
    UPDATE products SET deleted_at = now(), is_active = false WHERE id = p_parent_id;
  ELSE
    -- 0 active variants : just soft-delete the parent.
    UPDATE products SET deleted_at = now(), is_active = false WHERE id = p_parent_id;
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
