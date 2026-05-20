-- Session 27b / Phase 3 — reorder_categories_v1 (DnD reorder).
-- Assigns sort_order = 10, 20, 30, ... in the given sequence. Gaps for future inserts.
CREATE OR REPLACE FUNCTION reorder_categories_v1(
  p_ordered_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_count_in  INTEGER;
  v_count_db  INTEGER;
  v_id        UUID;
  v_pos       INTEGER := 10;
BEGIN
  IF NOT has_permission(v_caller_id, 'categories.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  v_count_in := COALESCE(array_length(p_ordered_ids, 1), 0);
  IF v_count_in = 0 THEN
    RAISE EXCEPTION 'empty_input'
      USING ERRCODE = '22023', HINT = 'p_ordered_ids must contain at least one id';
  END IF;

  -- Reject duplicates in input.
  IF v_count_in <> (SELECT count(DISTINCT id) FROM unnest(p_ordered_ids) AS id) THEN
    RAISE EXCEPTION 'duplicate_ids'
      USING ERRCODE = '22023', HINT = 'p_ordered_ids must not contain duplicates';
  END IF;

  -- Require complete coverage : input set must match the set of live categories.
  SELECT count(*) INTO v_count_db FROM categories WHERE deleted_at IS NULL;
  IF v_count_in <> v_count_db
     OR EXISTS (
       SELECT 1 FROM unnest(p_ordered_ids) AS id
        LEFT JOIN categories c ON c.id = id AND c.deleted_at IS NULL
        WHERE c.id IS NULL
     ) THEN
    RAISE EXCEPTION 'incomplete_ordered_ids'
      USING ERRCODE = '22023',
            HINT = 'p_ordered_ids must list every live category exactly once';
  END IF;

  FOREACH v_id IN ARRAY p_ordered_ids LOOP
    UPDATE categories SET sort_order = v_pos, updated_at = now()
     WHERE id = v_id;
    v_pos := v_pos + 10;
  END LOOP;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller_id, 'category.reorder', 'category', NULL,
          jsonb_build_object('ordered_ids', p_ordered_ids));

  RETURN jsonb_build_object(
    'count',       v_count_in,
    'ordered_ids', to_jsonb(p_ordered_ids)
  );
END;
$$;

COMMENT ON FUNCTION reorder_categories_v1(UUID[]) IS
  'Session 27b — Reorder categories by assigning sort_order=10,20,... in the given sequence. Requires complete coverage of live categories. perm categories.update.';
