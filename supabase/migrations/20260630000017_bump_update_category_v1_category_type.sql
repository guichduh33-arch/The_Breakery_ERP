-- Bump update_category_v1: swap is_raw_material → category_type (validated) in allowlist + UPDATE.
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
    'name','slug','sort_order','is_active','dispatch_station','kds_station','show_in_pos','category_type'
  ];
  v_key       TEXT;
  v_ignored   TEXT[] := ARRAY[]::TEXT[];
  v_new_slug  TEXT;
  v_new_type  TEXT;
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

  v_new_type := NULLIF(p_patch->>'category_type','');
  IF v_new_type IS NOT NULL AND v_new_type NOT IN ('raw_material','semi_finished','finished') THEN
    RAISE EXCEPTION 'invalid_category_type'
      USING ERRCODE = '22023', HINT = 'category_type must be raw_material|semi_finished|finished';
  END IF;

  UPDATE categories SET
    name             = COALESCE((p_patch->>'name')::TEXT, name),
    slug             = COALESCE(v_new_slug, slug),
    sort_order       = COALESCE((p_patch->>'sort_order')::INTEGER, sort_order),
    is_active        = COALESCE((p_patch->>'is_active')::BOOLEAN, is_active),
    dispatch_station = COALESCE((p_patch->>'dispatch_station')::TEXT, dispatch_station),
    kds_station      = COALESCE((p_patch->>'kds_station')::TEXT, kds_station),
    show_in_pos      = COALESCE((p_patch->>'show_in_pos')::BOOLEAN, show_in_pos),
    category_type    = COALESCE(v_new_type, category_type),
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
  'Update category via JSONB patch. 8-col allowlist (+show_in_pos/+category_type). perm categories.update.';
