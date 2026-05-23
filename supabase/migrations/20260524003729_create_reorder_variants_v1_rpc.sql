-- Session 27c / Wave 2 — Reorder variants (10/20/30 pattern from S27b).
-- Complete-coverage gate : caller must pass ALL active variant ids.
-- All column refs qualified with table aliases to avoid S27b 42702 ambiguous-id bug.

CREATE OR REPLACE FUNCTION reorder_variants_v1(
  p_parent_id           UUID,
  p_ordered_variant_ids UUID[]
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID := auth.uid();
  v_expected    INTEGER;
  v_provided    INTEGER;
  v_assigned    INTEGER := 0;
  v_id          UUID;
  v_sort        INTEGER := 10;
BEGIN
  IF NOT has_permission(v_user_id, 'products.variants.write') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  v_provided := COALESCE(array_length(p_ordered_variant_ids, 1), 0);

  SELECT COUNT(*) INTO v_expected
    FROM products p
   WHERE p.parent_product_id = p_parent_id
     AND p.is_active = true
     AND p.deleted_at IS NULL;

  IF v_provided != v_expected THEN
    RAISE EXCEPTION 'incomplete_coverage: expected % active variants, got %', v_expected, v_provided
      USING ERRCODE = 'P0004';
  END IF;

  -- Validate every id belongs to this parent.
  IF EXISTS (
    SELECT 1
      FROM unnest(p_ordered_variant_ids) AS v(variant_id)
     WHERE NOT EXISTS (
       SELECT 1 FROM products p2
        WHERE p2.id = v.variant_id AND p2.parent_product_id = p_parent_id
     )
  ) THEN
    RAISE EXCEPTION 'invalid_variant_id: some ids do not belong to parent %', p_parent_id USING ERRCODE = 'P0004';
  END IF;

  FOREACH v_id IN ARRAY p_ordered_variant_ids LOOP
    UPDATE products p
       SET variant_sort_order = v_sort, updated_at = now()
     WHERE p.id = v_id;
    v_sort := v_sort + 10;
    v_assigned := v_assigned + 1;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_user_id,
    'products.variants.reordered',
    'product',
    p_parent_id,
    jsonb_build_object('parent_id', p_parent_id, 'count', v_assigned)
  );

  RETURN v_assigned;
END;
$$;
