-- 20260601050100_bump_approve_expense_v3_manager_pin.sql
-- Audit fix H1 (2026-06-01) — approve_expense_v2 advertised a manager-PIN step-up
-- (the BO ApproveDialog collects a PIN and useApproveExpense sent it as the
-- `x-manager-pin` header) but the RPC NEVER validated it: v2 took no PIN arg and
-- read no header → the PIN gate was security theater (approval gated only by the
-- GoTrue JWT + SOD). An idle, unlocked BO session could approve expenses with no
-- re-auth.
--
-- v3 adds p_manager_pin TEXT and verifies it via verify_user_pin against the
-- caller's OWN profile — the cockpit pattern already used by close_fiscal_period_v1
-- and create_manual_je_v1. For a Postgres RPC the PIN travels as an arg, NOT a
-- header: the S25 "PIN-in-header" rule targets Edge Functions whose request bodies
-- get logged (PostgREST/pgaudit/proxies); RPC args are not body-logged that way.
--
-- Body is identical to approve_expense_v2 (SOD block 1 + block 2, snapshot freeze,
-- multi-step chain, JE on final step, audit log) plus the PIN block. Drops v2.

DROP FUNCTION IF EXISTS approve_expense_v2(UUID);

CREATE OR REPLACE FUNCTION approve_expense_v3(
  p_expense_id  UUID,
  p_manager_pin TEXT
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
    RAISE EXCEPTION 'approve_expense_v3: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Resolve caller profile + role
  SELECT id, role_code
    INTO v_caller_profile, v_caller_role
    FROM user_profiles
   WHERE auth_user_id = v_caller_uid
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v3: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- Permission gate: expenses.approve required
  IF NOT has_permission(v_caller_uid, 'expenses.approve') THEN
    RAISE EXCEPTION 'approve_expense_v3: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  -- PIN step-up re-auth (H1 fix): verify the caller's own manager PIN.
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'approve_expense_v3: pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.verify_user_pin(v_caller_profile, p_manager_pin) THEN
    RAISE EXCEPTION 'approve_expense_v3: invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  -- Lock the expense row for atomic state transition
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_expense_v3: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.status != 'submitted' THEN
    RAISE EXCEPTION 'approve_expense_v3: expense % is not submitted (current=%)',
      p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- SOD block 1: creator cannot approve own expense
  IF v_expense.created_by = v_caller_profile THEN
    RAISE EXCEPTION 'approve_expense_v3: sod_creator_block — creator cannot approve own expense'
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
    RAISE EXCEPTION 'approve_expense_v3: all steps already approved (step %/%)',
      v_next_step_idx, v_step_count USING ERRCODE = 'P0001';
  END IF;

  -- Extract required roles and label for this step
  SELECT
    ARRAY(SELECT jsonb_array_elements_text(v_snapshot -> v_next_step_idx -> 'role_codes')),
    v_snapshot -> v_next_step_idx ->> 'label'
  INTO v_required_roles, v_step_label;

  -- Role gate: caller's role must be in the required roles for this step
  IF NOT (v_caller_role = ANY(v_required_roles)) THEN
    RAISE EXCEPTION 'approve_expense_v3: missing_role — step % requires one of %',
      v_next_step_idx + 1, v_required_roles USING ERRCODE = 'P0003';
  END IF;

  -- SOD block 2: UNIQUE(expense_id, approver_user_id) prevents same person approving twice
  BEGIN
    INSERT INTO expense_approvals (expense_id, approver_user_id, step)
    VALUES (p_expense_id, v_caller_profile, v_next_step_idx + 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'approve_expense_v3: sod_already_approved — caller already approved this expense'
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

GRANT EXECUTE ON FUNCTION approve_expense_v3(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION approve_expense_v3(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION approve_expense_v3(UUID, TEXT) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION approve_expense_v3(UUID, TEXT) IS
  'S28 Task 2.C + H1 audit fix 2026-06-01: multi-step approve with SOD (creator block '
  '+ UNIQUE expense_approvals approver) AND server-side manager-PIN re-auth via '
  'verify_user_pin (PIN passed as RPC arg, not header — args are not body-logged). '
  'NULL snapshot fallback for legacy pre-S28 expenses.';
