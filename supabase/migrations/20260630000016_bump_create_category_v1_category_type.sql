-- Bump create_category_v1: swap is_raw_material → category_type (validated).
CREATE OR REPLACE FUNCTION create_category_v1(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_name      TEXT;
  v_slug      TEXT;
  v_sort      INTEGER;
  v_type      TEXT;
  v_row       categories%ROWTYPE;
BEGIN
  IF NOT has_permission(v_caller_id, 'categories.create') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  v_name := NULLIF(trim(p_payload->>'name'), '');
  v_slug := NULLIF(trim(lower(p_payload->>'slug')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'missing_required_fields'
      USING ERRCODE = '22023', HINT = 'name is required';
  END IF;

  IF v_slug IS NULL THEN
    v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
    v_slug := regexp_replace(v_slug, '^-|-$', '', 'g');
  END IF;

  IF EXISTS (SELECT 1 FROM categories WHERE slug = v_slug AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'slug_taken'
      USING ERRCODE = '23505', HINT = format('A category with slug=%s already exists', v_slug);
  END IF;

  v_type := COALESCE(NULLIF(p_payload->>'category_type',''), 'finished');
  IF v_type NOT IN ('raw_material','semi_finished','finished') THEN
    RAISE EXCEPTION 'invalid_category_type'
      USING ERRCODE = '22023', HINT = 'category_type must be raw_material|semi_finished|finished';
  END IF;

  v_sort := COALESCE(
    (p_payload->>'sort_order')::INTEGER,
    (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE deleted_at IS NULL)
  );

  INSERT INTO categories (name, slug, sort_order, is_active, dispatch_station, kds_station, show_in_pos, category_type)
  VALUES (
    v_name,
    v_slug,
    v_sort,
    COALESCE((p_payload->>'is_active')::BOOLEAN, true),
    COALESCE(NULLIF(p_payload->>'dispatch_station',''), 'none'),
    COALESCE(NULLIF(p_payload->>'kds_station',''), 'expo'),
    COALESCE((p_payload->>'show_in_pos')::BOOLEAN, true),
    v_type
  ) RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller_id, 'category.create', 'category', v_row.id, p_payload);

  RETURN to_jsonb(v_row);
END;
$$;

COMMENT ON FUNCTION create_category_v1(JSONB) IS
  'Create category. Auto-slugify, auto-append sort_order, +show_in_pos/+category_type. perm categories.create.';
