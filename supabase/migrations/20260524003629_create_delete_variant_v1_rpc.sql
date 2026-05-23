-- Session 27c / Wave 2 — Soft delete a variant (is_active=false).
-- Refuses if it's the last active variant of its parent.

CREATE OR REPLACE FUNCTION delete_variant_v1(p_variant_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      UUID := auth.uid();
  v_variant      RECORD;
  v_active_count INTEGER;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_variant FROM products WHERE id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_variant.parent_product_id IS NULL THEN
    RAISE EXCEPTION 'not_a_variant' USING ERRCODE = 'P0004';
  END IF;

  SELECT COUNT(*) INTO v_active_count
    FROM products
   WHERE parent_product_id = v_variant.parent_product_id
     AND is_active = true
     AND deleted_at IS NULL;

  IF v_active_count <= 1 THEN
    RAISE EXCEPTION 'last_variant_remaining: use convert_parent_to_standalone_v1 instead' USING ERRCODE = 'P0004';
  END IF;

  UPDATE products
     SET is_active = false, updated_at = now()
   WHERE id = p_variant_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user_id,
    'products.variant.deactivated',
    'product',
    p_variant_id,
    jsonb_build_object('parent_id', v_variant.parent_product_id, 'label', v_variant.variant_label)
  );

  RETURN p_variant_id;
END;
$$;
