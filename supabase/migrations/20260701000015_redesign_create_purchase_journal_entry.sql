-- 20260701000015_redesign_create_purchase_journal_entry.sql
-- Session 46 / Wave A5 — Redesign create_purchase_journal_entry() trigger.
--
-- D4 (spec §2): the reception ALWAYS posts DR INVENTORY_GENERAL / CR PURCHASE_PAYABLE.
-- The AP now has a universal existence for both cash and credit terms.
-- For cash-terms POs, an auto-payment is also recorded immediately after the AP:
--   JE #2: DR PURCHASE_PAYABLE / CR PURCHASE_CASH_OUT
-- This keeps net AP = 0 for cash POs while making the payment trace explicit in
-- the purchase_payments ledger.
--
-- ADR-003 NON-PKP preserved: vat_amount is still folded into INVENTORY_GENERAL
-- (v_inv_debit = subtotal + vat). The 1151 PURCHASE_VAT_INPUT account stays
-- disabled. This is the same rule as 20260603000012.
--
-- Idempotency: the existing pre-check (journal_entries SELECT for reference_id)
-- is preserved. The auto-cash-payment uses a deterministic idempotency_key
-- derived from the GRN id so retriggers are safe.
--
-- Trigger signature is unchanged (RETURNS TRIGGER). CREATE OR REPLACE is safe.
-- The REVOKE EXECUTE FROM PUBLIC at the end matches the existing grant status.

CREATE OR REPLACE FUNCTION create_purchase_journal_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv_id          UUID;
  v_ap_id           UUID;
  v_je_id           UUID;
  v_existing_je     UUID;
  v_entry_no        TEXT;
  v_subtotal        DECIMAL(14,2);
  v_vat             DECIMAL(14,2);
  v_total           DECIMAL(14,2);
  v_inv_debit       DECIMAL(14,2);
  v_payment_terms   TEXT;
  v_grn_date        DATE;
  -- Auto-payment (cash terms) variables.
  v_auto_pay_idem   UUID;
  v_auto_pay_exists BOOLEAN := FALSE;
BEGIN
  -- ── Idempotency pre-check: do nothing if JE already exists for this GRN ───
  SELECT id INTO v_existing_je FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = NEW.id
    LIMIT 1;
  IF v_existing_je IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ── Extract GRN data ───────────────────────────────────────────────────────
  v_subtotal      := COALESCE(NEW.subtotal,      0);
  v_vat           := COALESCE(NEW.vat_amount,    0);
  v_total         := COALESCE(NEW.total,         0);
  v_payment_terms := COALESCE(NEW.payment_terms, 'credit');
  v_grn_date      := COALESCE(NEW.received_date, NEW.created_at::date);

  -- ── Fiscal period guard ────────────────────────────────────────────────────
  PERFORM check_fiscal_period_open(v_grn_date);

  -- ── Resolve accounts ───────────────────────────────────────────────────────
  v_inv_id := resolve_mapping_account('INVENTORY_GENERAL');
  v_ap_id  := resolve_mapping_account('PURCHASE_PAYABLE');

  -- ── ADR-003 NON-PKP: fold vat into inventory cost (SAK EMKM §4.1) ─────────
  v_inv_debit := v_subtotal + v_vat;

  -- ── JE #1: Reception — DR INVENTORY_GENERAL / CR PURCHASE_PAYABLE (ALWAYS) ─
  v_entry_no := next_journal_entry_number(v_grn_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description,
    reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    v_grn_date,
    'Purchase receipt ' || COALESCE(NEW.grn_number, NEW.id::text),
    'purchase', NEW.id,
    'posted', v_total, v_total,
    NEW.received_by
  ) RETURNING id INTO v_je_id;

  -- DR Inventory (subtotal + non-recoverable VAT folded — ADR-003 NON-PKP)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_inv_id, v_inv_debit, 0,
      CASE WHEN v_vat > 0
        THEN 'Inventory received (incl. non-recoverable PPN ' || v_vat::TEXT || ')'
        ELSE 'Inventory received'
      END);

  -- CR PURCHASE_PAYABLE (ALWAYS — AP born at receipt, even for cash terms)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_ap_id, 0, v_total, 'AP recorded at receipt');

  -- ── Auto-payment for cash-terms POs ───────────────────────────────────────
  -- D4: cash terms → AP is created, then immediately cleared by a payment JE.
  -- C1: calls _record_po_payment_internal (not record_po_payment_v1) so there
  -- is NO auth.uid()/has_permission check. A user with purchasing.po.receive
  -- but without purchasing.po.pay must not be blocked here — the auto-payment
  -- is a SYSTEM action. NEW.received_by is already a user_profiles.id (set by
  -- receive_purchase_order_v2 from the actor's profile id).
  -- Deterministic idempotency key from GRN id survives trigger re-fires.
  IF v_payment_terms = 'cash' THEN
    v_auto_pay_idem := md5('auto_cash_pay:' || NEW.id::text)::uuid;

    SELECT EXISTS (
      SELECT 1 FROM purchase_payments WHERE idempotency_key = v_auto_pay_idem
    ) INTO v_auto_pay_exists;

    IF NOT v_auto_pay_exists THEN
      PERFORM _record_po_payment_internal(
        p_po_id           := NEW.po_id,
        p_amount          := v_total,
        p_method          := 'cash',
        p_reference       := 'Auto-payment at receipt: ' || COALESCE(NEW.grn_number, NEW.id::text),
        p_idempotency_key := v_auto_pay_idem,
        p_actor           := NEW.received_by
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION create_purchase_journal_entry() IS
  'Session 46 — S46-A5. Redesigned trigger on goods_receipt_notes INSERT. '
  'ALWAYS posts DR INVENTORY_GENERAL / CR PURCHASE_PAYABLE (AP born at receipt). '
  'ADR-003 NON-PKP: vat_amount folded into INVENTORY_GENERAL (no PURCHASE_VAT_INPUT). '
  'cash terms: auto-calls _record_po_payment_internal (C1: no auth/perm check) '
  'for the clearing JE (DR PURCHASE_PAYABLE / CR PURCHASE_CASH_OUT) + inserts purchase_payments row. '
  'Idempotent: pre-check on journal_entries + deterministic idempotency key for '
  'auto-payment prevents double-posting on re-fire. '
  'Signature unchanged (RETURNS TRIGGER) from 20260603000012.';

-- Trigger function is not directly callable via PostgREST; REVOKE PUBLIC is
-- defense-in-depth (matches previous migration's grant).
REVOKE EXECUTE ON FUNCTION create_purchase_journal_entry() FROM PUBLIC;
