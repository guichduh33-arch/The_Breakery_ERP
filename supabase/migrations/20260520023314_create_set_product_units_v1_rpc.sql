-- Session 27 / Wave 1.A.3 — set_product_units_v1 (REPLACE alts + UPSERT contexts).
CREATE OR REPLACE FUNCTION set_product_units_v1(
  p_product_id UUID,
  p_alts       JSONB,
  p_contexts   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_base_unit TEXT;
  v_valid_codes TEXT[];
  v_ctx_keys TEXT[] := ARRAY['stock_opname_unit', 'recipe_unit', 'purchase_unit', 'sales_unit'];
  v_k TEXT;
  v_v TEXT;
BEGIN
  IF NOT has_permission(v_caller_id, 'products.units.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT unit INTO v_base_unit FROM products
   WHERE id = p_product_id AND deleted_at IS NULL;
  IF v_base_unit IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE product_unit_alternatives
     SET deleted_at = now(), updated_at = now()
   WHERE product_id = p_product_id
     AND deleted_at IS NULL
     AND code NOT IN (
       SELECT (elt->>'code')::TEXT FROM jsonb_array_elements(p_alts) elt
     );

  INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, tags, display_order)
  SELECT
    p_product_id,
    (elt->>'code')::TEXT,
    (elt->>'factor_to_base')::NUMERIC,
    COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(elt->'tags'))::TEXT[],
      '{}'::TEXT[]
    ),
    COALESCE((elt->>'display_order')::INTEGER, 0)
  FROM jsonb_array_elements(p_alts) elt
  ON CONFLICT (product_id, code) WHERE deleted_at IS NULL
  DO UPDATE SET
    factor_to_base = EXCLUDED.factor_to_base,
    tags           = EXCLUDED.tags,
    display_order  = EXCLUDED.display_order,
    updated_at     = now();

  v_valid_codes := ARRAY[v_base_unit] || ARRAY(
    SELECT code FROM product_unit_alternatives
     WHERE product_id = p_product_id AND deleted_at IS NULL
  );

  FOREACH v_k IN ARRAY v_ctx_keys LOOP
    v_v := p_contexts->>v_k;
    IF v_v IS NULL OR v_v <> ALL(v_valid_codes) THEN
      RAISE EXCEPTION 'invalid_context_unit'
        USING HINT = format('Context %s references unknown unit %s', v_k, v_v),
              ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
  VALUES (
    p_product_id,
    p_contexts->>'stock_opname_unit',
    p_contexts->>'recipe_unit',
    p_contexts->>'purchase_unit',
    p_contexts->>'sales_unit'
  )
  ON CONFLICT (product_id) DO UPDATE SET
    stock_opname_unit = EXCLUDED.stock_opname_unit,
    recipe_unit       = EXCLUDED.recipe_unit,
    purchase_unit     = EXCLUDED.purchase_unit,
    sales_unit        = EXCLUDED.sales_unit,
    updated_at        = now();

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller_id, 'product.units', 'product', p_product_id,
          jsonb_build_object('alts', p_alts, 'contexts', p_contexts));

  RETURN jsonb_build_object(
    'alternatives', COALESCE((SELECT jsonb_agg(to_jsonb(a.*))
                       FROM product_unit_alternatives a
                       WHERE a.product_id = p_product_id AND a.deleted_at IS NULL),
                       '[]'::JSONB),
    'contexts',     (SELECT to_jsonb(c.*) FROM product_unit_contexts c
                       WHERE c.product_id = p_product_id)
  );
END;
$$;

COMMENT ON FUNCTION set_product_units_v1(UUID, JSONB, JSONB) IS
  'Session 27 Wave 1.A.3: REPLACE alternatives (soft-delete missing + UPSERT given) and UPSERT contexts. Validates contexts reference base unit or active alt. SECURITY DEFINER, perm gate products.units.update.';
