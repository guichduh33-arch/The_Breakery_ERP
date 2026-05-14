-- 20260517000122_create_expense_rpcs.sql
-- Session 13 / Phase 3.B / Migration 122 : Expense workflow RPCs (v1).
--
-- Creates :
--   - create_expense_v1   : insert in 'draft' status (idempotency_key dedupe).
--   - submit_expense_v1   : draft -> submitted.
--   - approve_expense_v1  : submitted -> approved, emits balanced JE.
--   - pay_expense_v1      : approved -> paid (+ emits payment JE if was credit).
--   - reject_expense_v1   : submitted -> rejected.
--
-- All SECURITY DEFINER + has_permission() gating + audit_logs writes.
-- JE rules in approve : DR category.account_id (net) + DR EXPENSE_VAT_INPUT (if vat)
--                       / CR EXPENSE_AP (credit) or EXPENSE_CASH_OUT (cash/transfer/card).

BEGIN;

-- ===========================================================================
-- 1. create_expense_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION create_expense_v1(
  p_category_id     UUID,
  p_amount          DECIMAL,
  p_payment_method  TEXT,
  p_description     TEXT,
  p_expense_date    DATE,
  p_vat_amount      DECIMAL DEFAULT 0,
  p_vendor_name     TEXT    DEFAULT NULL,
  p_receipt_url     TEXT    DEFAULT NULL,
  p_idempotency_key UUID    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_existing_id    UUID;
  v_new_id         UUID;
  v_expense_no     TEXT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'create_expense_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.create')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'create_expense_v1: missing permission expenses.create' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'create_expense_v1: amount must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_vat_amount < 0 THEN
    RAISE EXCEPTION 'create_expense_v1: vat_amount must be >= 0' USING ERRCODE = '22023';
  END IF;
  IF p_payment_method NOT IN ('cash','transfer','card','credit') THEN
    RAISE EXCEPTION 'create_expense_v1: invalid payment_method %', p_payment_method USING ERRCODE = '22023';
  END IF;

  -- Idempotency replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM expenses
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN v_existing_id;
    END IF;
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  v_expense_no := next_expense_number(p_expense_date);

  INSERT INTO expenses (
    expense_number, category_id, amount, vat_amount, payment_method,
    description, vendor_name, expense_date, receipt_url, status,
    created_by, idempotency_key
  ) VALUES (
    v_expense_no, p_category_id, p_amount, p_vat_amount, p_payment_method,
    p_description, p_vendor_name, p_expense_date, p_receipt_url, 'draft',
    v_caller_profile, p_idempotency_key
  )
  RETURNING id INTO v_new_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_uid, 'expense.create', 'expense', v_new_id,
          jsonb_build_object('expense_number', v_expense_no, 'amount', p_amount));

  RETURN v_new_id;
END $$;

COMMENT ON FUNCTION create_expense_v1(UUID,DECIMAL,TEXT,TEXT,DATE,DECIMAL,TEXT,TEXT,UUID) IS
  'Phase 3.B : creates a draft expense. Idempotency_key dedupes replays. Returns expense id.';

-- ===========================================================================
-- 2. submit_expense_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION submit_expense_v1(p_expense_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_row            expenses%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'submit_expense_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_expense_v1: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status <> 'draft' THEN
    RAISE EXCEPTION 'submit_expense_v1: expense % is not draft (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.manage')
    OR (v_row.created_by = v_caller_profile)
  ) THEN
    RAISE EXCEPTION 'submit_expense_v1: forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE expenses
     SET status = 'submitted', submitted_by = v_caller_profile, submitted_at = now()
   WHERE id = p_expense_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_uid, 'expense.submit', 'expense', p_expense_id, '{}'::jsonb);
END $$;

COMMENT ON FUNCTION submit_expense_v1(UUID) IS
  'Phase 3.B : submit draft expense for approval (draft -> submitted).';

-- ===========================================================================
-- 3. approve_expense_v1 — emits JE
-- ===========================================================================

CREATE OR REPLACE FUNCTION approve_expense_v1(
  p_expense_id     UUID,
  p_approval_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_row            expenses%ROWTYPE;
  v_cat_account    UUID;
  v_credit_acc     UUID;
  v_vat_input_acc  UUID;
  v_je_id          UUID;
  v_entry_no       TEXT;
  v_net            DECIMAL(14,2);
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'approve_expense_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.approve')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'approve_expense_v1: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  -- Lock row (atomic state transition).
  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approve_expense_v1: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'approve_expense_v1: expense % is not submitted (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  -- Fiscal period guard.
  PERFORM check_fiscal_period_open(v_row.expense_date);

  -- Resolve accounts.
  SELECT account_id INTO v_cat_account FROM expense_categories WHERE id = v_row.category_id;
  IF v_cat_account IS NULL THEN
    -- Fall back to EXPENSE_DEFAULT.
    v_cat_account := resolve_mapping_account('EXPENSE_DEFAULT');
  END IF;

  IF v_row.payment_method = 'credit' THEN
    v_credit_acc := resolve_mapping_account('EXPENSE_AP');
  ELSE
    v_credit_acc := resolve_mapping_account('EXPENSE_CASH_OUT');
  END IF;

  v_net := v_row.amount - v_row.vat_amount;
  IF v_net < 0 THEN
    RAISE EXCEPTION 'approve_expense_v1: vat_amount % exceeds amount %', v_row.vat_amount, v_row.amount USING ERRCODE = '22023';
  END IF;

  v_entry_no := next_journal_entry_number(v_row.expense_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, v_row.expense_date,
    'Expense ' || v_row.expense_number || ' - ' || left(v_row.description, 60),
    'expense', v_row.id,
    'posted', v_row.amount, v_row.amount, v_caller_uid
  )
  RETURNING id INTO v_je_id;

  -- DR category (net)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_cat_account, v_net, 0, 'Expense - category');

  -- DR VAT Input (if any)
  IF v_row.vat_amount > 0 THEN
    v_vat_input_acc := resolve_mapping_account('EXPENSE_VAT_INPUT');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_vat_input_acc, v_row.vat_amount, 0, 'Expense - VAT input');
  END IF;

  -- CR credit account
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_je_id, v_credit_acc, 0, v_row.amount,
          CASE WHEN v_row.payment_method = 'credit' THEN 'Expense - AP' ELSE 'Expense - Cash' END);

  -- Update expense (status + audit fields + je link).
  UPDATE expenses
     SET status = 'approved',
         approved_by = v_caller_profile,
         approved_at = now(),
         approval_notes = p_approval_notes,
         je_id = v_je_id
   WHERE id = p_expense_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_uid, 'expense.approve', 'expense', p_expense_id,
          jsonb_build_object('je_id', v_je_id, 'amount', v_row.amount));

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'je_id', v_je_id,
    'entry_number', v_entry_no,
    'status', 'approved'
  );
END $$;

COMMENT ON FUNCTION approve_expense_v1(UUID, TEXT) IS
  'Phase 3.B : approve expense + emit balanced JE (submitted -> approved). DR category (+ VAT) / CR AP (credit) or Cash (else).';

-- ===========================================================================
-- 4. pay_expense_v1 — credit-only post-payment JE (else just status flip)
-- ===========================================================================

CREATE OR REPLACE FUNCTION pay_expense_v1(
  p_expense_id     UUID,
  p_payment_method TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_row            expenses%ROWTYPE;
  v_je_id          UUID;
  v_entry_no       TEXT;
  v_ap_acc         UUID;
  v_cash_acc       UUID;
  v_was_credit     BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'pay_expense_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.pay')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'pay_expense_v1: missing permission expenses.pay' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pay_expense_v1: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'pay_expense_v1: expense % is not approved (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  v_was_credit := (v_row.payment_method = 'credit');

  -- If was credit, emit a 2nd JE to clear the AP and move to cash.
  IF v_was_credit THEN
    PERFORM check_fiscal_period_open(CURRENT_DATE);

    v_ap_acc   := resolve_mapping_account('EXPENSE_AP');
    v_cash_acc := resolve_mapping_account('EXPENSE_CASH_OUT');
    v_entry_no := next_journal_entry_number(CURRENT_DATE);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by
    ) VALUES (
      v_entry_no, CURRENT_DATE,
      'Expense payment ' || v_row.expense_number,
      'expense_payment', v_row.id,
      'posted', v_row.amount, v_row.amount, v_caller_uid
    )
    RETURNING id INTO v_je_id;

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_ap_acc,   v_row.amount, 0,            'Clear AP'),
      (v_je_id, v_cash_acc, 0,            v_row.amount, 'Cash payment');

    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_je_id = v_je_id,
           payment_method = COALESCE(p_payment_method, v_row.payment_method)
     WHERE id = p_expense_id;
  ELSE
    -- Non-credit : just flip to paid (JE already covered cash leg at approval).
    UPDATE expenses
       SET status = 'paid',
           paid_by = v_caller_profile,
           paid_at = now(),
           payment_method = COALESCE(p_payment_method, v_row.payment_method)
     WHERE id = p_expense_id;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_uid, 'expense.pay', 'expense', p_expense_id,
          jsonb_build_object('payment_je_id', v_je_id, 'was_credit', v_was_credit));

  RETURN jsonb_build_object(
    'expense_id', p_expense_id,
    'payment_je_id', v_je_id,
    'status', 'paid',
    'was_credit', v_was_credit
  );
END $$;

COMMENT ON FUNCTION pay_expense_v1(UUID, TEXT) IS
  'Phase 3.B : mark expense as paid. If was credit, emits a payment JE (DR AP / CR Cash). Else just flips status.';

-- ===========================================================================
-- 5. reject_expense_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION reject_expense_v1(
  p_expense_id UUID,
  p_reason     TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_row            expenses%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'reject_expense_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reject_expense_v1: reason is required' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    has_permission(v_caller_uid, 'expenses.approve')
    OR has_permission(v_caller_uid, 'expenses.manage')
  ) THEN
    RAISE EXCEPTION 'reject_expense_v1: missing permission expenses.approve' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  SELECT * INTO v_row FROM expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reject_expense_v1: expense % not found', p_expense_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'reject_expense_v1: expense % is not submitted (current=%)', p_expense_id, v_row.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE expenses
     SET status = 'rejected',
         rejected_reason = p_reason,
         approved_by = v_caller_profile,
         rejected_at = now()
   WHERE id = p_expense_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_uid, 'expense.reject', 'expense', p_expense_id,
          jsonb_build_object('reason', p_reason));
END $$;

COMMENT ON FUNCTION reject_expense_v1(UUID, TEXT) IS
  'Phase 3.B : reject a submitted expense with a mandatory reason (submitted -> rejected).';

-- ===========================================================================
-- 6. Grants (PostgREST exposure)
-- ===========================================================================

GRANT EXECUTE ON FUNCTION create_expense_v1(UUID, DECIMAL, TEXT, TEXT, DATE, DECIMAL, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_expense_v1(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_expense_v1(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION pay_expense_v1(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_expense_v1(UUID, TEXT) TO authenticated;

COMMIT;
