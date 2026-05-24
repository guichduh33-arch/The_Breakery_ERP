CREATE OR REPLACE FUNCTION set_expense_threshold_v1(
  p_threshold_id  UUID    DEFAULT NULL,
  p_category_id   UUID    DEFAULT NULL,
  p_amount_min    NUMERIC DEFAULT 0,
  p_amount_max    NUMERIC DEFAULT NULL,
  p_steps         JSONB   DEFAULT '[]'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_result_id  UUID;
  v_overlap    INT;
  v_step       JSONB;
BEGIN
  -- 1. Auth check
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: caller not authenticated'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Permission gate (expenses.thresholds.write — seeded in Task 3.A)
  IF NOT has_permission(v_caller_uid, 'expenses.thresholds.write') THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: missing permission expenses.thresholds.write'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Validate p_steps is a JSONB array
  IF jsonb_typeof(p_steps) != 'array' THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: p_steps must be a JSONB array'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate each step shape: { role_codes: TEXT[] non-empty, label: TEXT non-empty }
  FOR v_step IN SELECT jsonb_array_elements(p_steps) LOOP
    IF jsonb_typeof(v_step -> 'role_codes') != 'array'
       OR jsonb_array_length(v_step -> 'role_codes') = 0
       OR jsonb_typeof(v_step -> 'label') != 'string'
       OR length(v_step ->> 'label') = 0
    THEN
      RAISE EXCEPTION 'set_expense_threshold_v1: invalid step shape — each step needs non-empty role_codes array + non-empty label'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 5. Validate p_amount_max not NULL
  IF p_amount_max IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: p_amount_max must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Validate range: p_amount_max > p_amount_min
  IF p_amount_max <= p_amount_min THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: p_amount_max must be > p_amount_min'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Overlap check: no other row for same category_id covering any part of [p_amount_min, p_amount_max)
  --    IS DISTINCT FROM p_threshold_id excludes self on UPDATE (NULL IS DISTINCT FROM NULL = false,
  --    so on INSERT p_threshold_id=NULL includes all existing rows — correct).
  SELECT COUNT(*) INTO v_overlap
  FROM expense_approval_thresholds
  WHERE id IS DISTINCT FROM p_threshold_id          -- exclude self on UPDATE
    AND category_id IS NOT DISTINCT FROM p_category_id
    AND p_amount_min < amount_max
    AND p_amount_max > amount_min;

  IF v_overlap > 0 THEN
    RAISE EXCEPTION 'set_expense_threshold_v1: threshold_overlap — another row covers part of [%, %) for this category',
      p_amount_min, p_amount_max
      USING ERRCODE = 'P0002';
  END IF;

  -- 8. INSERT or UPDATE
  IF p_threshold_id IS NULL THEN
    INSERT INTO expense_approval_thresholds (category_id, amount_min, amount_max, steps)
    VALUES (p_category_id, p_amount_min, p_amount_max, p_steps)
    RETURNING id INTO v_result_id;
  ELSE
    UPDATE expense_approval_thresholds
    SET category_id = p_category_id,
        amount_min  = p_amount_min,
        amount_max  = p_amount_max,
        steps       = p_steps
    WHERE id = p_threshold_id
    RETURNING id INTO v_result_id;

    IF v_result_id IS NULL THEN
      RAISE EXCEPTION 'set_expense_threshold_v1: threshold % not found', p_threshold_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 9. Audit log (canonical columns: actor_id, action, entity_type, entity_id, metadata)
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_uid,
    CASE WHEN p_threshold_id IS NULL
         THEN 'expense_threshold.created'
         ELSE 'expense_threshold.updated'
    END,
    'expense_approval_thresholds',
    v_result_id,
    jsonb_build_object(
      'category_id', p_category_id,
      'amount_min',  p_amount_min,
      'amount_max',  p_amount_max,
      'steps',       p_steps
    )
  );

  -- 10. Return the threshold UUID
  RETURN v_result_id;
END $$;

GRANT EXECUTE ON FUNCTION set_expense_threshold_v1(UUID, UUID, NUMERIC, NUMERIC, JSONB)
  TO authenticated;

COMMENT ON FUNCTION set_expense_threshold_v1(UUID, UUID, NUMERIC, NUMERIC, JSONB) IS
  'S28: UPSERT expense approval threshold (admin-gated via expenses.thresholds.write). Validates step shape + range + overlap. Returns threshold UUID. NULL p_threshold_id = INSERT, non-NULL = UPDATE.';
