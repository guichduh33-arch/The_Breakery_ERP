-- S28 Wave 2.G — delete_expense_threshold_v1
-- Soft-deletes (hard DELETE) an expense approval threshold row.
-- Gate: expenses.thresholds.write (ADMIN / SUPER_ADMIN)

CREATE OR REPLACE FUNCTION delete_expense_threshold_v1(p_threshold_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_deleted    INT;
BEGIN
  -- Auth-first gate
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'delete_expense_threshold_v1: caller not authenticated'
      USING ERRCODE = '28000';
  END IF;

  -- Permission gate
  IF NOT has_permission(v_caller_uid, 'expenses.thresholds.write') THEN
    RAISE EXCEPTION 'delete_expense_threshold_v1: missing permission expenses.thresholds.write'
      USING ERRCODE = '42501';
  END IF;

  -- Delete the threshold row
  DELETE FROM expense_approval_thresholds WHERE id = p_threshold_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Not-found guard
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'delete_expense_threshold_v1: threshold % not found', p_threshold_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Audit log using canonical columns: actor_id, action, entity_type, entity_id, metadata
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_uid,
    'expense_threshold.deleted',
    'expense_approval_thresholds',
    p_threshold_id,
    '{}'::jsonb
  );

  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION delete_expense_threshold_v1(UUID) TO authenticated;

COMMENT ON FUNCTION delete_expense_threshold_v1(UUID) IS
  'S28: hard-delete an expense approval threshold. Gate: expenses.thresholds.write. Emits audit_log expense_threshold.deleted.';
