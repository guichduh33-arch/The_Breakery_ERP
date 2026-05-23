-- Session 27c / Wave 2 — Patch a variant (4-col allowlist).

CREATE OR REPLACE FUNCTION update_variant_v1(
  p_variant_id UUID,
  p_patch      JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID := auth.uid();
  v_variant    RECORD;
  v_old_label  TEXT;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_variant FROM products WHERE id = p_variant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_variant.parent_product_id IS NULL THEN
    RAISE EXCEPTION 'not_a_variant: % is not a variant', p_variant_id USING ERRCODE = 'P0004';
  END IF;

  v_old_label := v_variant.variant_label;

  -- 4-col allowlist patch
  UPDATE products
     SET variant_label      = COALESCE(p_patch->>'variant_label', variant_label),
         sku                = COALESCE(p_patch->>'sku', sku),
         retail_price       = COALESCE((p_patch->>'retail_price')::NUMERIC, retail_price),
         variant_sort_order = COALESCE((p_patch->>'variant_sort_order')::INTEGER, variant_sort_order),
         updated_at         = now()
   WHERE id = p_variant_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user_id,
    'products.variant.updated',
    'product',
    p_variant_id,
    jsonb_build_object('patch', p_patch, 'old_label', v_old_label)
  );

  RETURN p_variant_id;
END;
$$;
