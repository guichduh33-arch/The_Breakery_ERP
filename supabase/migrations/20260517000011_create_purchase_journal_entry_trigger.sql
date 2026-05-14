-- 20260517000011_create_purchase_journal_entry_trigger.sql
-- Session 13 / Phase 1.A / migration 10-006 :
--   Create create_purchase_journal_entry() trigger FUNCTION (NOT yet attached).
--   The trigger ATTACH on `goods_receipt_notes` (table created Phase 3.A) is deferred.
--
-- Posting :
--   DR INVENTORY_GENERAL (subtotal)
--   DR PURCHASE_VAT_INPUT (vat)
--   CR PURCHASE_PAYABLE   (total)  — when payment_terms != 'cash'
--   CR PURCHASE_CASH_OUT  (total)  — when payment_terms = 'cash'
--
-- Idempotency : pre-SELECT on (reference_type='purchase', reference_id=NEW.id).
-- Fiscal guard : check_fiscal_period_open(NEW.created_at::date).

CREATE OR REPLACE FUNCTION create_purchase_journal_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv_id      UUID;
  v_vat_id      UUID;
  v_ap_id       UUID;
  v_cash_id     UUID;
  v_je_id       UUID;
  v_existing    UUID;
  v_entry_no    TEXT;
  v_subtotal    DECIMAL(14,2);
  v_vat         DECIMAL(14,2);
  v_total       DECIMAL(14,2);
  v_payment_terms TEXT;
BEGIN
  -- Idempotency : skip if 'purchase' JE already exists for this row.
  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = NEW.id
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Pull amounts from the row (column names assumed per Phase 3.A spec).
  -- The function compiles even before `goods_receipt_notes` exists ; PostgreSQL
  -- defers column resolution to runtime (the trigger is not attached here).
  v_subtotal      := COALESCE((NEW).subtotal,       0);
  v_vat           := COALESCE((NEW).vat_amount,     0);
  v_total         := COALESCE((NEW).total,          0);
  v_payment_terms := COALESCE((NEW).payment_terms,  'credit');

  -- Fiscal guard.
  PERFORM check_fiscal_period_open(COALESCE((NEW).received_date, (NEW).created_at::date));

  v_inv_id  := resolve_mapping_account('INVENTORY_GENERAL');
  v_vat_id  := resolve_mapping_account('PURCHASE_VAT_INPUT');

  IF v_payment_terms = 'cash' THEN
    v_cash_id := resolve_mapping_account('PURCHASE_CASH_OUT');
  ELSE
    v_ap_id   := resolve_mapping_account('PURCHASE_PAYABLE');
  END IF;

  v_entry_no := next_journal_entry_number(
                  COALESCE((NEW).received_date, (NEW).created_at::date));

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    COALESCE((NEW).received_date, (NEW).created_at::date),
    'Purchase ' || COALESCE((NEW).grn_number, NEW.id::text),
    'purchase', NEW.id,
    'posted', v_total, v_total,
    (NEW).received_by
  ) RETURNING id INTO v_je_id;

  -- DR Inventory + DR VAT input
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_inv_id, v_subtotal, 0, 'Inventory received'),
    (v_je_id, v_vat_id, v_vat,      0, 'VAT input (PPN Masukan)');

  -- CR AP or Cash depending on terms.
  IF v_payment_terms = 'cash' THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_cash_id, 0, v_total, 'Cash paid (immediate)');
  ELSE
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_ap_id,   0, v_total, 'AP recorded (credit terms)');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION create_purchase_journal_entry() IS
  'D11/D12/D14 (Phase 1.A — function only). Trigger ATTACH is deferred to Phase 3.A '
  'when goods_receipt_notes table is created. DR INVENTORY_GENERAL + DR PURCHASE_VAT_INPUT '
  '/ CR PURCHASE_PAYABLE or PURCHASE_CASH_OUT depending on payment_terms.';

REVOKE EXECUTE ON FUNCTION create_purchase_journal_entry() FROM PUBLIC;
