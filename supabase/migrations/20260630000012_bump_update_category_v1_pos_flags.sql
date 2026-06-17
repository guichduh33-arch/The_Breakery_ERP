-- Bump update_category_v1: extend allowlist + UPDATE with show_in_pos + is_raw_material.
CREATE OR REPLACE FUNCTION update_category_v1(
  p_category_id UUID,
  p_patch       JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_allowed   CONSTANT TEXT[] := ARRAY[
    'name','slug','sort_order','is_active','dispatch_station','kds_station','show_in_pos','is_raw_material'
  ];
  v_key       TEXT;
  v_ignored   TEXT[] := ARRAY[]::TEXT[];
  v_new_slug  TEXT;
  v_row       categories%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'categories.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = p_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch)
  LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      v_ignored := array_append(v_ignored, v_key);
    END IF;
  END LOOP;

  v_new_slug := NULLIF(trim(lower(p_patch->>'slug')), '');
  IF v_new_slug IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM categories
        WHERE slug = v_new_slug AND id <> p_category_id AND deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'slug_taken'
      USING ERRCODE = '23505', HINT = format('A category with slug=%s already exists', v_new_slug);
  END IF;

  UPDATE categories SET
    name             = COALESCE((p_patch->>'name')::TEXT, name),
    slug             = COALESCE(v_new_slug, slug),
    sort_order       = COALESCE((p_patch->>'sort_order')::INTEGER, sort_order),
    is_active        = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    dispatch_station = COALESCE((p_patch->>'dispatch_station')::TEXT, dispatch_station),
    kds_station      = COALESCE((p_patch->>'kds_station')::TEXT, kds_station),
    show_in_pos      = COALESCE((p_patch->>'show_in_pos')::BOOLEAN, show_in_pos),
    is_raw_material  = COALESCE((p_patch->>'is_raw_material')::BOOLEAN, is_raw_material),
    updated_at       = now()
  WHERE id = p_category_id
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, metadata)
  VALUES (v_caller_id, 'category.update', 'category', p_category_id, p_patch,
          jsonb_build_object('ignored_fields', v_ignored));

  RETURN jsonb_build_object(
    'category',       to_jsonb(v_row),
    'ignored_fields', to_jsonb(v_ignored)
  );
END;
$$;

COMMENT ON FUNCTION update_category_v1(UUID, JSONB) IS
  'Update category via JSONB patch. 8-col allowlist (+show_in_pos/+is_raw_material). perm categories.update.';
