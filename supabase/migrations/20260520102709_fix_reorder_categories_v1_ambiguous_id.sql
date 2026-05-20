-- Session 27b corrective : the original `_101850` used `unnest(...) AS id`
-- which collides with `categories.id` inside the LEFT JOIN, raising 42702
-- "column reference id is ambiguous". Rename inner aliases to `x` /
-- `input_id` to disambiguate.
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

  IF v_count_in <> (SELECT count(DISTINCT x) FROM unnest(p_ordered_ids) AS x) THEN
    RAISE EXCEPTION 'duplicate_ids'
      USING ERRCODE = '22023', HINT = 'p_ordered_ids must not contain duplicates';
  END IF;

  SELECT count(*) INTO v_count_db FROM categories WHERE deleted_at IS NULL;
  IF v_count_in <> v_count_db
     OR EXISTS (
       SELECT 1 FROM unnest(p_ordered_ids) AS input_id
        LEFT JOIN categories c ON c.id = input_id AND c.deleted_at IS NULL
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
  'Session 27b — Reorder categories by assigning sort_order=10,20,... in the given sequence. Requires complete coverage. perm categories.update. Corrective : rename inner column aliases to avoid 42702 ambiguity.';
