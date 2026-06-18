-- 20260701000013_create_record_po_payment_v1_rpc.sql
-- Session 46 / Wave A4 — record_po_payment_v1 RPC + internal helper.
--
-- Architecture (C1 correction):
--   _record_po_payment_internal — does ALL ledger+JE work, NO auth.uid(), NO
--     has_permission. Takes p_actor (user_profiles.id) for paid_by/audit_logs.
--     Called by: record_po_payment_v1 (user-facing), create_purchase_journal_entry
--     trigger (system auto-payment on cash POs). NOT callable from PostgREST.
--   record_po_payment_v1 — thin gated wrapper: auth-first → permission check →
--     input validation → delegate to _record_po_payment_internal.
--
-- This ensures a user with purchasing.po.receive but WITHOUT purchasing.po.pay
-- is NOT blocked when receiving a cash-terms PO (the auto-payment is a SYSTEM
-- action, not gated). Pattern mirrors S28 _emit_expense_je.
--
-- C4 correction — operation order inside the internal helper:
--   1. Idempotency early-read (SELECT existing row)
--   2. Lock PO + overpayment guard
--   3. Fiscal guard
--   4. Resolve JE accounts
--   5. INSERT purchase_payments FIRST (unique_violation catch here)
--   6. On success: POST JE with reference_id = v_payment_id immediately (no
--      separate UPDATE needed — no orphan JE risk on race)
--   7. Derived status + audit + return
--
-- Permission: purchasing.po.pay (seeded in _017).

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal helper — NOT PostgREST-callable
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _record_po_payment_internal(
  p_po_id           UUID,
  p_amount          NUMERIC,
  p_method          TEXT,
  p_reference       TEXT,
  p_idempotency_key UUID,
  p_actor           UUID    -- user_profiles.id of the actor (NOT auth.uid())
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_po             RECORD;
  v_existing_pay   RECORD;
  v_payment_id     UUID;
  v_total_amount   NUMERIC(14,2);   -- scalar for the early-read replay path (v_po RECORD not yet assigned there)
  v_total_paid     NUMERIC(14,2);
  v_remaining_due  NUMERIC(14,2);
  v_derived_status TEXT;
  v_je_id          UUID;
  v_entry_no       TEXT;
  v_ap_id          UUID;
  v_cr_id          UUID;
BEGIN
  -- ── Idempotency early-read ────────────────────────────────────────────────
  -- p_idempotency_key is NOT NULL (caller must enforce).
  SELECT * INTO v_existing_pay
    FROM purchase_payments
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
  IF FOUND THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
      FROM purchase_payments WHERE purchase_order_id = v_existing_pay.purchase_order_id;
    SELECT total_amount INTO v_total_amount
      FROM purchase_orders WHERE id = v_existing_pay.purchase_order_id;
    v_remaining_due  := v_total_amount - v_total_paid;
    v_derived_status := CASE
      WHEN v_remaining_due <= 0 THEN 'paid'
      WHEN v_total_paid > 0     THEN 'partial'
      ELSE 'unpaid'
    END;
    SELECT id INTO v_je_id FROM journal_entries
      WHERE reference_type = 'purchase_payment' AND reference_id = v_existing_pay.id
      LIMIT 1;
    RETURN jsonb_build_object(
      'payment_id',        v_existing_pay.id,
      'je_id',             v_je_id,
      'amount_paid',       v_existing_pay.amount,
      'total_paid',        v_total_paid,
      'remaining_due',     v_remaining_due,
      'derived_status',    v_derived_status,
      'idempotent_replay', true
    );
  END IF;

  -- ── Lock PO + validate remaining due ─────────────────────────────────────
  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM purchase_payments WHERE purchase_order_id = p_po_id;

  v_remaining_due := v_po.total_amount - v_total_paid;

  IF p_amount > v_remaining_due THEN
    RAISE EXCEPTION 'overpayment_not_allowed: remaining=% requested=%',
      v_remaining_due, p_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Fiscal period guard ───────────────────────────────────────────────────
  PERFORM check_fiscal_period_open(current_date);

  -- ── Resolve JE accounts ───────────────────────────────────────────────────
  v_ap_id := resolve_mapping_account('PURCHASE_PAYABLE');
  v_cr_id := CASE
    WHEN lower(p_method) = 'cash' THEN resolve_mapping_account('PURCHASE_CASH_OUT')
    ELSE                               resolve_mapping_account('PURCHASE_PAYMENT_BANK')
  END;

  -- ── C4: INSERT purchase_payments FIRST, then post JE ─────────────────────
  -- Race guard: if two concurrent callers both pass the early-read SELECT,
  -- only one INSERT succeeds; the other catches unique_violation and returns
  -- the winner's row without posting a duplicate JE.
  BEGIN
    INSERT INTO purchase_payments (
      purchase_order_id, amount, method, paid_at, paid_by,
      reference, idempotency_key
    ) VALUES (
      p_po_id, p_amount, p_method, now(), p_actor,
      p_reference, p_idempotency_key
    ) RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent winner already inserted. Re-read and return replay envelope.
    SELECT * INTO v_existing_pay
      FROM purchase_payments WHERE idempotency_key = p_idempotency_key;
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
      FROM purchase_payments WHERE purchase_order_id = p_po_id;
    v_remaining_due  := v_po.total_amount - v_total_paid;
    v_derived_status := CASE
      WHEN v_remaining_due <= 0 THEN 'paid'
      WHEN v_total_paid > 0     THEN 'partial'
      ELSE 'unpaid'
    END;
    SELECT id INTO v_je_id FROM journal_entries
      WHERE reference_type = 'purchase_payment' AND reference_id = v_existing_pay.id
      LIMIT 1;
    RETURN jsonb_build_object(
      'payment_id',        v_existing_pay.id,
      'je_id',             v_je_id,
      'amount_paid',       v_existing_pay.amount,
      'total_paid',        v_total_paid,
      'remaining_due',     v_remaining_due,
      'derived_status',    v_derived_status,
      'idempotent_replay', true
    );
  END;

  -- ── Post payment JE with reference_id = v_payment_id (no orphan risk) ────
  v_entry_no := next_journal_entry_number(current_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description,
    reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    current_date,
    'PO payment: ' || v_po.po_number || ' (' || p_method || ')',
    'purchase_payment', v_payment_id,
    'posted', p_amount, p_amount,
    p_actor
  ) RETURNING id INTO v_je_id;

  -- DR PURCHASE_PAYABLE
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_ap_id, p_amount, 0,
      'AP settlement for PO ' || v_po.po_number);

  -- CR Cash or Bank
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cr_id, 0, p_amount,
      'Payment via ' || p_method || COALESCE(' ref: ' || p_reference, ''));

  -- ── Compute derived status ────────────────────────────────────────────────
  v_total_paid    := v_total_paid + p_amount;
  v_remaining_due := v_po.total_amount - v_total_paid;
  v_derived_status := CASE
    WHEN v_remaining_due <= 0 THEN 'paid'
    WHEN v_total_paid > 0     THEN 'partial'
    ELSE 'unpaid'
  END;

  -- ── Audit (canonical audit_logs) ─────────────────────────────────────────
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor,
    'po.payment_recorded',
    'purchase_order',
    p_po_id,
    jsonb_build_object(
      'payment_id',      v_payment_id,
      'po_number',       v_po.po_number,
      'amount',          p_amount,
      'method',          p_method,
      'reference',       p_reference,
      'total_paid',      v_total_paid,
      'remaining_due',   v_remaining_due,
      'derived_status',  v_derived_status,
      'je_id',           v_je_id,
      'idempotency_key', p_idempotency_key,
      'rpc_version',     'v1'
    )
  );

  RETURN jsonb_build_object(
    'payment_id',        v_payment_id,
    'je_id',             v_je_id,
    'amount_paid',       p_amount,
    'total_paid',        v_total_paid,
    'remaining_due',     v_remaining_due,
    'derived_status',    v_derived_status,
    'idempotent_replay', false
  );
END $$;

COMMENT ON FUNCTION _record_po_payment_internal(UUID, NUMERIC, TEXT, TEXT, UUID, UUID) IS
  'Session 46 — S46-A4 (C1/C4). Internal helper: ledger insert FIRST then JE. '
  'No auth.uid() / no has_permission — caller supplies p_actor (user_profiles.id). '
  'NOT PostgREST-callable. Called by record_po_payment_v1 (user path) and '
  'create_purchase_journal_entry trigger (system auto-payment on cash POs).';

-- Internal helper must NOT be callable via PostgREST or by any user role.
REVOKE EXECUTE ON FUNCTION _record_po_payment_internal(UUID, NUMERIC, TEXT, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _record_po_payment_internal(UUID, NUMERIC, TEXT, TEXT, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION _record_po_payment_internal(UUID, NUMERIC, TEXT, TEXT, UUID, UUID) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public gated wrapper
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION record_po_payment_v1(
  p_po_id           UUID,
  p_amount          NUMERIC,
  p_method          TEXT,
  p_reference       TEXT    DEFAULT NULL,
  p_idempotency_key UUID    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
BEGIN
  -- ── Auth-first ────────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.pay') THEN
    RAISE EXCEPTION 'permission_denied: purchasing.po.pay' USING ERRCODE = 'P0003';
  END IF;

  -- ── Input validation ──────────────────────────────────────────────────────
  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_method IS NULL OR length(trim(p_method)) = 0 THEN
    RAISE EXCEPTION 'method_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;

  -- ── Delegate all work to internal helper ──────────────────────────────────
  RETURN _record_po_payment_internal(
    p_po_id           := p_po_id,
    p_amount          := p_amount,
    p_method          := p_method,
    p_reference       := p_reference,
    p_idempotency_key := p_idempotency_key,
    p_actor           := v_profile
  );
END $$;

COMMENT ON FUNCTION record_po_payment_v1(UUID, NUMERIC, TEXT, TEXT, UUID) IS
  'Session 46 — S46-A4. User-facing gated wrapper for _record_po_payment_internal. '
  'Gate: purchasing.po.pay. Auth-first. Input validation. Delegates to internal helper. '
  'Errors: P0001 not_authenticated/amount_positive/overpayment/method_required, '
  'P0002 po_not_found, P0003 permission_denied.';

-- ─── GRANT + canonical 3-line REVOKE pair ────────────────────────────────────
GRANT EXECUTE ON FUNCTION record_po_payment_v1(UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION record_po_payment_v1(UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_po_payment_v1(UUID, NUMERIC, TEXT, TEXT, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
