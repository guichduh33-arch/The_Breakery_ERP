-- Session 27 / Wave 1.A.3 — upsert_product_modifiers_v1 (clean-slate + revive pattern).
CREATE OR REPLACE FUNCTION upsert_product_modifiers_v1(
  p_product_id UUID,
  p_groups     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_group  JSONB;
  v_option JSONB;
  v_gname  TEXT;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.modifiers.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE product_modifiers
     SET deleted_at = now(), is_active = false, updated_at = now()
   WHERE product_id = p_product_id
     AND deleted_at IS NULL;

  FOR v_group IN SELECT * FROM jsonb_array_elements(p_groups)
  LOOP
    v_gname := v_group->>'group_name';

    FOR v_option IN SELECT * FROM jsonb_array_elements(v_group->'options')
    LOOP
      INSERT INTO product_modifiers (
        product_id, group_name, group_sort_order, group_required, group_type,
        option_label, option_sort_order, price_adjustment, is_default,
        ingredients_to_deduct
      )
      VALUES (
        p_product_id,
        v_gname,
        COALESCE((v_group->>'group_sort_order')::INTEGER, 0),
        COALESCE((v_group->>'group_required')::BOOLEAN, false),
        (v_group->>'group_type')::modifier_group_type,
        v_option->>'option_label',
        COALESCE((v_option->>'option_sort_order')::INTEGER, 0),
        COALESCE((v_option->>'price_adjustment')::NUMERIC, 0),
        COALESCE((v_option->>'is_default')::BOOLEAN, false),
        COALESCE(v_option->'ingredients_to_deduct', '[]'::JSONB)
      )
      ON CONFLICT (product_id, category_id, group_name, option_label)
      DO UPDATE SET
        group_sort_order      = EXCLUDED.group_sort_order,
        group_required        = EXCLUDED.group_required,
        group_type            = EXCLUDED.group_type,
        option_sort_order     = EXCLUDED.option_sort_order,
        price_adjustment      = EXCLUDED.price_adjustment,
        is_default            = EXCLUDED.is_default,
        ingredients_to_deduct = EXCLUDED.ingredients_to_deduct,
        is_active             = true,
        deleted_at            = NULL,
        updated_at            = now();
    END LOOP;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller_id, 'product.modifiers', 'product', p_product_id, p_groups);

  RETURN jsonb_build_object(
    'modifiers', COALESCE((SELECT jsonb_agg(to_jsonb(pm.*))
                    FROM product_modifiers pm
                    WHERE pm.product_id = p_product_id
                      AND pm.deleted_at IS NULL), '[]'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION upsert_product_modifiers_v1(UUID, JSONB) IS
  'Session 27 Wave 1.A.3: Clean-slate soft-delete + UPSERT product modifiers. Revives matching rows via ON CONFLICT (preserves created_at). SECURITY DEFINER, perm gate products.modifiers.update.';
