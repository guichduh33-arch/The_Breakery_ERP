-- 20260706000023_allow_super_admin_self_approve_expense_v3.sql
-- Policy change (2026-06-23) — relax SOD block 1 for SUPER_ADMIN only.
--
-- Context : single-operator businesses (sole owner) need to approve their own
-- expenses. The owner (role SUPER_ADMIN) creates AND must approve the expense.
-- Until now `approve_expense_v3` raised `sod_creator_block` for ANY creator =
-- approver, which made self-approval impossible for the owner.
--
-- This migration relaxes SOD block 1 *exclusively* for SUPER_ADMIN. Every other
-- role (ADMIN, MANAGER, …) is still blocked from approving an expense it created
-- — the anti-fraud control stays intact for the rest of the org. When a SUPER_ADMIN
-- self-approves, a dedicated `expense.self_approved` audit row is written (in
-- addition to the standard `expense.approved_step`) and the standard audit metadata
-- carries `self_approval: true` so the bypass is fully traceable.
--
-- SOD block 2 (UNIQUE expense_id, approver — no double-approve of the SAME step in a
-- multi-step chain) is untouched and still applies to SUPER_ADMIN.
--
-- CREATE OR REPLACE in place (signature unchanged → no version bump; same pattern as
-- 20260622000014 which wired the lockout helper in place). PIN verification keeps the
-- S38 lockout helper `_verify_pin_with_lockout` — do NOT regress to verify_user_pin.

CREATE OR REPLACE FUNCTION public.approve_expense_v3(
  p_expense_id  UUID,
  p_manager_pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
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
  v_self_approval  BOOLEAN := false;
BEGIN
  -- Auth check FIRST (2.A.1 corrective: prevents info-disclosure to unauthenticated callers)
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

  -- PIN step-up re-auth (H1 fix): verify the caller's own manager PIN — S38 lockout helper.
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'approve_expense_v3: pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_caller_profile, p_manager_pin) THEN
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

  -- SOD block 1: creator cannot approve own expense — EXCEPT SUPER_ADMIN (single-operator policy).
  IF v_expense.created_by = v_caller_profile THEN
    IF v_caller_role <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'approve_expense_v3: sod_creator_block — creator cannot approve own expense'
        USING ERRCODE = 'P0001';
    END IF;
    v_self_approval := true;
  END IF;

  -- Resolve snapshot: use frozen snapshot or NULL fallback for legacy expenses (pre-S28)
  v_snapshot := v_expense.required_approval_steps_snapshot;

  IF v_snapshot IS NULL THEN
    v_snapshot := '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb;
  END IF;

  v_step_count    := jsonb_array_length(v_snapshot);
  v_next_step_idx := COALESCE(v_expense.current_approval_step, 0);

  IF v_next_step_idx >= v_step_count THEN
    RAISE EXCEPTION 'approve_expense_v3: all steps already approved (step %/%)',
      v_next_step_idx, v_step_count USING ERRCODE = 'P0001';
  END IF;

  SELECT
    ARRAY(SELECT jsonb_array_elements_text(v_snapshot -> v_next_step_idx -> 'role_codes')),
    v_snapshot -> v_next_step_idx ->> 'label'
  INTO v_required_roles, v_step_label;

  IF NOT (v_caller_role = ANY(v_required_roles)) THEN
    RAISE EXCEPTION 'approve_expense_v3: missing_role — step % requires one of %',
      v_next_step_idx + 1, v_required_roles USING ERRCODE = 'P0003';
  END IF;

  -- SOD block 2: UNIQUE(expense_id, approver_user_id) prevents same person approving twice
  -- (still applies to SUPER_ADMIN — guards multi-step double-approve of the same step).
  BEGIN
    INSERT INTO expense_approvals (expense_id, approver_user_id, step)
    VALUES (p_expense_id, v_caller_profile, v_next_step_idx + 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'approve_expense_v3: sod_already_approved — caller already approved this expense'
      USING ERRCODE = 'P0001';
  END;

  UPDATE expenses
     SET current_approval_step = v_next_step_idx + 1
   WHERE id = p_expense_id;

  IF v_next_step_idx + 1 = v_step_count THEN
    PERFORM check_fiscal_period_open(v_expense.expense_date);

    UPDATE expenses
       SET status      = 'approved',
           approved_at = now(),
           approved_by = v_caller_profile
     WHERE id = p_expense_id;

    PERFORM _emit_expense_je(p_expense_id);
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_uid,
    'expense.approved_step',
    'expense',
    p_expense_id,
    jsonb_build_object(
      'step',          v_next_step_idx + 1,
      'of_total',      v_step_count,
      'final',         (v_next_step_idx + 1 = v_step_count),
      'label',         v_step_label,
      'self_approval', v_self_approval
    )
  );

  -- Dedicated trail when a SUPER_ADMIN bypasses SOD block 1 to approve their own expense.
  IF v_self_approval THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_caller_uid,
      'expense.self_approved',
      'expense',
      p_expense_id,
      jsonb_build_object(
        'role',     v_caller_role,
        'step',     v_next_step_idx + 1,
        'of_total', v_step_count
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'step',       v_next_step_idx + 1,
    'of_total',   v_step_count,
    'status',     CASE WHEN v_next_step_idx + 1 = v_step_count THEN 'approved' ELSE 'submitted' END
  );
END $function$;

GRANT EXECUTE ON FUNCTION approve_expense_v3(UUID, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION approve_expense_v3(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION approve_expense_v3(UUID, TEXT) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION approve_expense_v3(UUID, TEXT) IS
  'S28 + H1 (2026-06-01 PIN re-auth) + S38 lockout + 2026-06-23 policy: SUPER_ADMIN may '
  'self-approve own expense (SOD block 1 relaxed for SUPER_ADMIN only; audited via '
  'expense.self_approved). SOD block 2 (no double-approve same step) still applies to all. '
  'PIN verified server-side via _verify_pin_with_lockout (5/15min lockout).';
