-- Task 2.C — Session 28 — approve_expense_v2: SOD + multi-step chain (drops v1)
-- Auth check FIRST (S25 pattern + 2.A.1 corrective)
-- audit_logs uses: actor_id, action, entity_type, entity_id, metadata (not payload)

DROP FUNCTION IF EXISTS approve_expense_v1(UUID, TEXT);

CREATE OR REPLACE FUNCTION approve_expense_v2(
  p_expense_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_caller_role    TEXT;
  v_expense        expenses%ROWTYPE;
  v_snapshot       JSONB;
  v_step_count     INT;
  v_next_step_idx  INT;
  v_required_roles TEXT[];
  v_step_label     TEXT;
BEGIN
  -- Auth check FIRST (2.A.1 corrective pattern: prevents info-disclosure to unauthenticated callers)
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Resolve caller profile + role
  SELECT id, role_code
    INTO v_caller_profile, v_caller_role
    FROM user_profiles
   WHERE auth_user_id = v_caller_uid
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- Permission gate: expenses.approve required
  IF NOT has_permission(v_caller_uid, 'expenses.approve') THEN
    RAISE EXCEPTION 'approve_expense_v2: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  -- Lock the expense row for atomic state transition
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_expense_v2: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.status != 'submitted' THEN
    RAISE EXCEPTION 'approve_expense_v2: expense % is not submitted (current=%)',
      p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- SOD block 1: creator cannot approve own expense
  IF v_expense.created_by = v_caller_profile THEN
    RAISE EXCEPTION 'approve_expense_v2: sod_creator_block — creator cannot approve own expense'
      USING ERRCODE = 'P0001';
  END IF;

  -- Resolve snapshot: use frozen snapshot or NULL fallback for legacy expenses (pre-S28)
  v_snapshot := v_expense.required_approval_steps_snapshot;

  IF v_snapshot IS NULL THEN
    -- Legacy NULL snapshot fallback: 1-step v1-compatible behavior
    v_snapshot := '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb;
  END IF;

  v_step_count    := jsonb_array_length(v_snapshot);
  v_next_step_idx := COALESCE(v_expense.current_approval_step, 0);  -- 0-based index into snapshot

  IF v_next_step_idx >= v_step_count THEN
    RAISE EXCEPTION 'approve_expense_v2: all steps already approved (step %/%)',
      v_next_step_idx, v_step_count USING ERRCODE = 'P0001';
  END IF;

  -- Extract required roles and label for this step
  SELECT
    ARRAY(SELECT jsonb_array_elements_text(v_snapshot -> v_next_step_idx -> 'role_codes')),
    v_snapshot -> v_next_step_idx ->> 'label'
  INTO v_required_roles, v_step_label;

  -- Role gate: caller's role must be in the required roles for this step
  IF NOT (v_caller_role = ANY(v_required_roles)) THEN
    RAISE EXCEPTION 'approve_expense_v2: missing_role — step % requires one of %',
      v_next_step_idx + 1, v_required_roles USING ERRCODE = 'P0003';
  END IF;

  -- SOD block 2: UNIQUE(expense_id, approver_user_id) prevents same person approving twice
  BEGIN
    INSERT INTO expense_approvals (expense_id, approver_user_id, step)
    VALUES (p_expense_id, v_caller_profile, v_next_step_idx + 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'approve_expense_v2: sod_already_approved — caller already approved this expense'
      USING ERRCODE = 'P0001';
  END;

  -- Advance the step counter
  UPDATE expenses
     SET current_approval_step = v_next_step_idx + 1
   WHERE id = p_expense_id;

  -- If this was the final step → mark approved + emit JE
  IF v_next_step_idx + 1 = v_step_count THEN
    -- Fiscal period guard (mirrors approve_expense_v1 — must be open to post JE)
    PERFORM check_fiscal_period_open(v_expense.expense_date);

    UPDATE expenses
       SET status      = 'approved',
           approved_at = now(),
           approved_by = v_caller_profile
     WHERE id = p_expense_id;

    -- Emit balanced journal entry (SECURITY DEFINER helper — auth.uid() still resolves)
    PERFORM _emit_expense_je(p_expense_id);
  END IF;

  -- Audit log (using actual column names: actor_id, entity_type, entity_id, metadata)
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_uid,
    'expense.approved_step',
    'expense',
    p_expense_id,
    jsonb_build_object(
      'step',     v_next_step_idx + 1,
      'of_total', v_step_count,
      'final',    (v_next_step_idx + 1 = v_step_count),
      'label',    v_step_label
    )
  );

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'step',       v_next_step_idx + 1,
    'of_total',   v_step_count,
    'status',     CASE WHEN v_next_step_idx + 1 = v_step_count THEN 'approved' ELSE 'submitted' END
  );
END $$;

GRANT EXECUTE ON FUNCTION approve_expense_v2(UUID) TO authenticated;

COMMENT ON FUNCTION approve_expense_v2(UUID) IS
  'S28 Task 2.C: multi-step approve with SOD enforcement (creator block + UNIQUE expense_approvals approver). PIN gate handled client-side via x-manager-pin header (S25 pattern). NULL snapshot fallback for legacy pre-S28 expenses.';
