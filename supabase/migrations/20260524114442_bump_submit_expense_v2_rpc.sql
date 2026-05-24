-- 20260524114442_bump_submit_expense_v2_rpc.sql
-- Session 28 / Wave 2.A
-- Drops submit_expense_v1, creates submit_expense_v2 (threshold resolution + snapshot freeze +
-- auto-approve path) and the internal helper _emit_expense_je (extracted from approve_expense_v1).
--
-- JE shape (identical to approve_expense_v1):
--   DR expense_categories.account_id (net = amount - vat_amount)
--   DR EXPENSE_VAT_INPUT             (vat_amount, if > 0)
--   CR EXPENSE_AP                    (if payment_method = 'credit')
--   CR EXPENSE_CASH_OUT              (cash / transfer / card)
--   total_debit = total_credit = amount  (balanced)

-- ===========================================================================
-- 0. _emit_expense_je — internal helper (extracted from approve_expense_v1 lines 199-253)
-- ===========================================================================

CREATE OR REPLACE FUNCTION _emit_expense_je(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid    UUID := auth.uid();
  v_expense       expenses%ROWTYPE;
  v_cat_account   UUID;
  v_credit_acc    UUID;
  v_vat_input_acc UUID;
  v_je_id         UUID;
  v_entry_no      TEXT;
  v_net           DECIMAL(14,2);
BEGIN
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '_emit_expense_je: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  -- Resolve debit account: category-specific or fallback to EXPENSE_DEFAULT
  SELECT account_id INTO v_cat_account FROM expense_categories WHERE id = v_expense.category_id;
  IF v_cat_account IS NULL THEN
    v_cat_account := resolve_mapping_account('EXPENSE_DEFAULT');
  END IF;

  -- Resolve credit account: AP (credit terms) or Cash/Bank
  IF v_expense.payment_method = 'credit' THEN
    v_credit_acc := resolve_mapping_account('EXPENSE_AP');
  ELSE
    v_credit_acc := resolve_mapping_account('EXPENSE_CASH_OUT');
  END IF;

  v_net := v_expense.amount - v_expense.vat_amount;
  IF v_net < 0 THEN
    RAISE EXCEPTION '_emit_expense_je: vat_amount % exceeds amount %',
      v_expense.vat_amount, v_expense.amount USING ERRCODE = '22023';
  END IF;

  v_entry_no := next_journal_entry_number(v_expense.expense_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    v_expense.expense_date,
    'Expense ' || v_expense.expense_number || ' - ' || left(v_expense.description, 60),
    'expense',
    v_expense.id,
    'posted',
    v_expense.amount,
    v_expense.amount,
    v_caller_uid
  )
  RETURNING id INTO v_je_id;

  -- DR category (net amount)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cat_account, v_net, 0, 'Expense - category');

  -- DR VAT Input (if any)
  IF v_expense.vat_amount > 0 THEN
    v_vat_input_acc := resolve_mapping_account('EXPENSE_VAT_INPUT');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_vat_input_acc, v_expense.vat_amount, 0, 'Expense - VAT input');
  END IF;

  -- CR credit account (full amount)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_credit_acc, 0, v_expense.amount,
          CASE WHEN v_expense.payment_method = 'credit' THEN 'Expense - AP' ELSE 'Expense - Cash' END);

  -- Stamp je_id on the expense row
  UPDATE expenses SET je_id = v_je_id WHERE id = p_expense_id;

  RETURN v_je_id;
END $$;

COMMENT ON FUNCTION _emit_expense_je(UUID) IS
  'S28 internal helper : emits a balanced JE for an expense (extracted from approve_expense_v1). '
  'DR category (net) + DR VAT Input (if any) / CR AP or Cash. Stamps expenses.je_id. '
  'Called by submit_expense_v2 (auto-approve path) and approve_expense_v2.';

-- Grant to authenticated so approve_expense_v2 (also SECURITY DEFINER) can call it cross-function.
-- The function itself is SECURITY DEFINER so actual DB privilege escalation is controlled.
GRANT EXECUTE ON FUNCTION _emit_expense_je(UUID) TO authenticated;

-- ===========================================================================
-- 1. Drop submit_expense_v1
-- ===========================================================================

DROP FUNCTION IF EXISTS submit_expense_v1(UUID);

-- ===========================================================================
-- 2. submit_expense_v2 — threshold resolution + snapshot freeze + auto-approve
-- ===========================================================================

CREATE OR REPLACE FUNCTION submit_expense_v2(
  p_expense_id      UUID,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_expense        expenses%ROWTYPE;
  v_replay         expenses%ROWTYPE;
  v_resolved_steps JSONB;
  v_step_count     INT;
  v_je_id          UUID;
BEGIN
  -- Idempotency replay: if key already used, return cached result
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_replay FROM expenses WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'expense_id',        v_replay.id,
        'status',            v_replay.status,
        'auto_approved',     v_replay.auto_approved,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- Auth check
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v2: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- Permission gate: expenses.create (own submission) OR expenses.manage (admin override)
  IF NOT (
    has_permission(v_caller_uid, 'expenses.create')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'submit_expense_v2: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;

  -- Lock row for atomic state transition
  SELECT * INTO v_expense FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_expense_v2: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_expense.status <> 'draft' THEN
    RAISE EXCEPTION 'submit_expense_v2: expense % is not draft (current=%)',
      p_expense_id, v_expense.status USING ERRCODE = 'P0001';
  END IF;

  -- Resolve threshold: category-specific first, then NULL (global default)
  -- Range: amount_min <= amount < amount_max
  SELECT steps INTO v_resolved_steps
  FROM expense_approval_thresholds
  WHERE (category_id = v_expense.category_id OR category_id IS NULL)
    AND v_expense.amount >= amount_min
    AND v_expense.amount <  amount_max
  ORDER BY category_id NULLS LAST
  LIMIT 1;

  IF v_resolved_steps IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v2: no threshold matches amount=% category=%',
      v_expense.amount, v_expense.category_id USING ERRCODE = 'P0002';
  END IF;

  v_step_count := jsonb_array_length(v_resolved_steps);

  IF v_step_count = 0 THEN
    -- Auto-approve path: freeze snapshot, set status=approved, emit JE
    -- Fiscal period guard (mirrors approve_expense_v1)
    PERFORM check_fiscal_period_open(v_expense.expense_date);

    UPDATE expenses SET
      required_approval_steps_snapshot = v_resolved_steps,
      auto_approved                    = true,
      status                           = 'approved',
      submitted_at                     = now(),
      submitted_by                     = v_caller_profile,
      approved_at                      = now(),
      approved_by                      = v_caller_profile,
      idempotency_key                  = COALESCE(p_idempotency_key, idempotency_key)
    WHERE id = p_expense_id;

    -- Emit balanced JE via helper (stamps je_id on expense row)
    v_je_id := _emit_expense_je(p_expense_id);

    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_caller_uid, 'expense.auto_approved', 'expense', p_expense_id,
            jsonb_build_object('amount', v_expense.amount, 'je_id', v_je_id));

    RETURN jsonb_build_object(
      'expense_id',     p_expense_id,
      'status',         'approved',
      'auto_approved',  true,
      'steps_required', 0
    );
  ELSE
    -- Multi-step path: freeze snapshot, set status=submitted
    UPDATE expenses SET
      required_approval_steps_snapshot = v_resolved_steps,
      auto_approved                    = false,
      status                           = 'submitted',
      submitted_at                     = now(),
      submitted_by                     = v_caller_profile,
      idempotency_key                  = COALESCE(p_idempotency_key, idempotency_key)
    WHERE id = p_expense_id;

    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_caller_uid, 'expense.submitted', 'expense', p_expense_id,
            jsonb_build_object('amount', v_expense.amount, 'steps_required', v_step_count));

    RETURN jsonb_build_object(
      'expense_id',     p_expense_id,
      'status',         'submitted',
      'auto_approved',  false,
      'steps_required', v_step_count
    );
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION submit_expense_v2(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION submit_expense_v2(UUID, UUID) IS
  'S28 : submit draft expense — resolves approval threshold, freezes step snapshot, '
  'auto-approves + emits JE if steps=[] (amount < 100k default bracket). '
  'Idempotent via p_idempotency_key. Replaces submit_expense_v1 (dropped same migration).';
