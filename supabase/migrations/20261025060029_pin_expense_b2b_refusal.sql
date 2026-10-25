-- Corps live conservés ; le refus PIN retourne sans annuler le compteur de sécurité.
CREATE OR REPLACE FUNCTION public.approve_expense_v5(p_expense_id uuid, p_manager_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v5: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id, role_code
    INTO v_caller_profile, v_caller_role
    FROM user_profiles
   WHERE auth_user_id = v_caller_uid
     AND deleted_at IS NULL
   LIMIT 1;

  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v5: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'expenses.approve') THEN
    RAISE EXCEPTION 'approve_expense_v5: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'approve_expense_v5: pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_caller_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_expense_v5: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_expense.status != 'submitted' THEN
    RAISE EXCEPTION 'approve_expense_v5: expense % is not submitted (current=%)',
      p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- SOD block 1: creator cannot approve own expense — EXCEPT SUPER_ADMIN (single-operator policy).
  IF v_expense.created_by = v_caller_profile THEN
    IF v_caller_role <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION 'approve_expense_v5: sod_creator_block — creator cannot approve own expense'
        USING ERRCODE = 'P0001';
    END IF;
    v_self_approval := true;
  END IF;

  v_snapshot := v_expense.required_approval_steps_snapshot;

  IF v_snapshot IS NULL THEN
    v_snapshot := '[{"role_codes":["MANAGER","ADMIN","SUPER_ADMIN"],"label":"Manager approval"}]'::jsonb;
  END IF;

  v_step_count    := jsonb_array_length(v_snapshot);
  v_next_step_idx := COALESCE(v_expense.current_approval_step, 0);

  IF v_next_step_idx >= v_step_count THEN
    RAISE EXCEPTION 'approve_expense_v5: all steps already approved (step %/%)',
      v_next_step_idx, v_step_count USING ERRCODE = 'P0001';
  END IF;

  SELECT
    ARRAY(SELECT jsonb_array_elements_text(v_snapshot -> v_next_step_idx -> 'role_codes')),
    v_snapshot -> v_next_step_idx ->> 'label'
  INTO v_required_roles, v_step_label;

  IF NOT (v_caller_role = ANY(v_required_roles)) THEN
    RAISE EXCEPTION 'approve_expense_v5: missing_role — step % requires one of %',
      v_next_step_idx + 1, v_required_roles USING ERRCODE = 'P0003';
  END IF;

  BEGIN
    INSERT INTO expense_approvals (expense_id, approver_user_id, step)
    VALUES (p_expense_id, v_caller_profile, v_next_step_idx + 1);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'approve_expense_v5: sod_already_approved — caller already approved this expense'
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

  -- audit_logs.actor_id référence user_profiles(id), pas auth.users(id).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile,
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

  IF v_self_approval THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_caller_profile,
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
DROP FUNCTION public.approve_expense_v4(uuid,text);
REVOKE ALL ON FUNCTION public.approve_expense_v5(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_expense_v5(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.adjust_b2b_balance_v3(p_customer_id uuid, p_delta numeric, p_reason text, p_manager_pin text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             UUID := auth.uid();
  v_profile_id      UUID;
  v_customer_type   customer_type;
  v_balance_before  NUMERIC(14,2);
  v_balance_after   NUMERIC(14,2);
  v_existing_log_id BIGINT;
  v_existing_meta   JSONB;
  v_audit_id        BIGINT;
  v_amt             NUMERIC(14,2);
  v_ar_id           UUID;
  v_adj_id          UUID;
  v_je_id           UUID;
  v_entry_no        TEXT;
  v_now             TIMESTAMPTZ := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'b2b.balance.adjust') THEN
    RAISE EXCEPTION 'permission_denied: b2b.balance.adjust' USING ERRCODE = 'P0003';
  END IF;

  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._verify_pin_with_lockout(v_profile_id, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'invalid_delta' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, metadata INTO v_existing_log_id, v_existing_meta
      FROM audit_logs
     WHERE action = 'b2b.balance.adjusted'
       AND metadata ? 'idempotency_key'
       AND metadata->>'idempotency_key' = p_idempotency_key::text
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'customer_id',       (v_existing_meta->>'customer_id')::uuid,
        'balance_before',    (v_existing_meta->>'balance_before')::numeric,
        'balance_after',     (v_existing_meta->>'balance_after')::numeric,
        'delta',             (v_existing_meta->>'delta')::numeric,
        'je_id',             NULLIF(v_existing_meta->>'je_id','')::uuid,
        'audit_log_id',      v_existing_log_id,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  SELECT customer_type, b2b_current_balance
    INTO v_customer_type, v_balance_before
    FROM customers
   WHERE id = p_customer_id AND deleted_at IS NULL
   FOR UPDATE;

  IF v_customer_type IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_type <> 'b2b' THEN
    RAISE EXCEPTION 'customer_not_b2b' USING ERRCODE = 'P0001';
  END IF;

  v_balance_before := COALESCE(v_balance_before, 0);
  v_balance_after  := v_balance_before + p_delta;

  IF v_balance_after < 0 THEN
    RAISE EXCEPTION 'balance_underflow (before: %, delta: %, after: %)',
      v_balance_before, p_delta, v_balance_after
      USING ERRCODE = 'P0011';
  END IF;

  v_amt    := abs(p_delta);
  v_ar_id  := resolve_mapping_account('B2B_AR');
  v_adj_id := resolve_mapping_account('B2B_AR_ADJUSTMENT');

  PERFORM check_fiscal_period_open(v_now::date);
  v_entry_no := next_journal_entry_number(v_now::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, v_now::date,
    'B2B AR adjustment (cust ' || p_customer_id::text || ') — ' || left(p_reason, 160),
    'b2b_adjustment', NULL,
    'posted', v_amt, v_amt, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_ar_id,  GREATEST(p_delta, 0::numeric),  GREATEST(-p_delta, 0::numeric), 'AR B2B adjustment'),
    (v_je_id, v_adj_id, GREATEST(-p_delta, 0::numeric), GREATEST(p_delta, 0::numeric),  'AR B2B write-off / recovery');

  UPDATE customers
     SET b2b_current_balance = v_balance_after,
         updated_at = now()
   WHERE id = p_customer_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.balance.adjusted', 'customers', p_customer_id,
    jsonb_build_object(
      'customer_id',     p_customer_id,
      'delta',           p_delta,
      'reason',          p_reason,
      'balance_before',  v_balance_before,
      'balance_after',   v_balance_after,
      'idempotency_key', p_idempotency_key,
      'je_id',           v_je_id,
      'rpc_version',     'v3'
    )
  ) RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'customer_id',       p_customer_id,
    'balance_before',    v_balance_before,
    'balance_after',     v_balance_after,
    'delta',             p_delta,
    'je_id',             v_je_id,
    'audit_log_id',      v_audit_id,
    'idempotent_replay', FALSE
  );
END $function$;
DROP FUNCTION public.adjust_b2b_balance_v2(uuid,numeric,text,text,uuid);
REVOKE ALL ON FUNCTION public.adjust_b2b_balance_v3(uuid,numeric,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_b2b_balance_v3(uuid,numeric,text,text,uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
