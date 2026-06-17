-- delete_category_v1 — soft-delete a product category (pattern: delete_product_v1 S45).
-- Auth-first, idempotent replay (keyed on deleted_at), guard against in-use categories.
CREATE OR REPLACE FUNCTION public.delete_category_v1(
  p_category_id     UUID,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_category      categories%ROWTYPE;
  v_product_count INT;
BEGIN
  -- Auth-first
  IF NOT public.has_permission(v_caller_id, 'categories.delete') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Load regardless of deleted_at so replay finds the row and a true 404 still raises.
  SELECT * INTO v_category FROM categories WHERE id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotent replay: already soft-deleted.
  IF v_category.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('category_id', p_category_id, 'deleted', true, 'idempotent_replay', true);
  END IF;

  -- Guard: refuse to delete a category still holding products (would orphan them).
  SELECT COUNT(*) INTO v_product_count
    FROM products
   WHERE category_id = p_category_id
     AND deleted_at  IS NULL;

  IF v_product_count > 0 THEN
    RAISE EXCEPTION 'category_has_products'
      USING ERRCODE = 'P0001',
            DETAIL  = jsonb_build_object('product_count', v_product_count)::TEXT;
  END IF;

  UPDATE categories
     SET is_active  = false,
         deleted_at = now(),
         updated_at = now()
   WHERE id = p_category_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_id, 'category.deleted', 'category', p_category_id,
    jsonb_build_object('name', v_category.name, 'slug', v_category.slug, 'idempotency_key', p_idempotency_key)
  );

  RETURN jsonb_build_object('category_id', p_category_id, 'deleted', true, 'idempotent_replay', false);
END;
$$;

COMMENT ON FUNCTION public.delete_category_v1(UUID, UUID) IS
  'Soft-delete a product category (is_active=false + deleted_at=now()). Idempotent replay on deleted_at. Guards: category_not_found (P0002), category_has_products (P0001). Perm gate categories.delete (ADMIN+/SUPER_ADMIN). Audit category.deleted.';
