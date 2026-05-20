-- Session 27b / Phase 3 — create_category_v1 SECURITY DEFINER RPC.
-- Auto-slugify from name if slug omitted. Auto-append sort_order.
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

  -- Auto-derive slug from name if not provided (slugify : lowercase + non-alnum→'-').
  IF v_slug IS NULL THEN
    v_slug := regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g');
    v_slug := regexp_replace(v_slug, '^-|-$', '', 'g');
  END IF;

  IF EXISTS (SELECT 1 FROM categories WHERE slug = v_slug AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'slug_taken'
      USING ERRCODE = '23505', HINT = format('A category with slug=%s already exists', v_slug);
  END IF;

  -- Default sort_order : append at the end (max + 10).
  v_sort := COALESCE(
    (p_payload->>'sort_order')::INTEGER,
    (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM categories WHERE deleted_at IS NULL)
  );

  INSERT INTO categories (name, slug, sort_order, is_active, dispatch_station, kds_station)
  VALUES (
    v_name,
    v_slug,
    v_sort,
    COALESCE((p_payload->>'is_active')::BOOLEAN, true),
    COALESCE(NULLIF(p_payload->>'dispatch_station',''), 'none'),
    COALESCE(NULLIF(p_payload->>'kds_station',''), 'expo')
  ) RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller_id, 'category.create', 'category', v_row.id, p_payload);

  RETURN to_jsonb(v_row);
END;
$$;

COMMENT ON FUNCTION create_category_v1(JSONB) IS
  'Session 27b — Create category. Auto-slugify from name if slug omitted. Auto-append sort_order. perm categories.create.';
