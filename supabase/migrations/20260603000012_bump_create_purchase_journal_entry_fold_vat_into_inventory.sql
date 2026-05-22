-- 20260603000012_bump_create_purchase_journal_entry_fold_vat_into_inventory.sql
-- Session 26 / Wave 1.C / migration _012 :
--   Refactor create_purchase_journal_entry pour fold le vat_amount supplier
--   dans INVENTORY_GENERAL au lieu de PURCHASE_VAT_INPUT.
--
-- Closes audit finding F-S26-AC-09 (new — ADR-003 NON-PKP).
--
-- Avant :
--   DR INVENTORY_GENERAL (subtotal)
--   DR PURCHASE_VAT_INPUT (vat)
--   CR PURCHASE_PAYABLE  (total)
--
-- Après (non-PKP — PPN supplier non récupérable, capitalisé dans le cost) :
--   DR INVENTORY_GENERAL (subtotal + vat)
--   CR PURCHASE_PAYABLE  (total)
--
-- Rationale :
--   The Breakery est NON-PKP (ADR-003). Le PPN 11% facturé par les suppliers
--   PKP ne peut PAS être réclamé comme crédit TVA — il doit donc être inclus
--   dans le coût d'acquisition des biens reçus (SAK EMKM §4.1).
--
-- Note : on garde le compte PURCHASE_VAT_INPUT et le mapping pour préserver les
-- migrations historiques + audit trail. La phase 1.H désactive l'account 1151
-- (is_active=false) avec une note. Si statut PKP change un jour, ré-activer +
-- bumper ce trigger en sens inverse.

CREATE OR REPLACE FUNCTION create_purchase_journal_entry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv_id      UUID;
  v_ap_id       UUID;
  v_cash_id     UUID;
  v_je_id       UUID;
  v_existing    UUID;
  v_entry_no    TEXT;
  v_subtotal    DECIMAL(14,2);
  v_vat         DECIMAL(14,2);
  v_total       DECIMAL(14,2);
  v_inv_debit   DECIMAL(14,2);  -- F-S26-AC-09 : subtotal + vat folded
  v_payment_terms TEXT;
BEGIN
  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = NEW.id
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_subtotal      := COALESCE((NEW).subtotal,       0);
  v_vat           := COALESCE((NEW).vat_amount,     0);
  v_total         := COALESCE((NEW).total,          0);
  v_payment_terms := COALESCE((NEW).payment_terms,  'credit');

  PERFORM check_fiscal_period_open(COALESCE((NEW).received_date, (NEW).created_at::date));

  v_inv_id  := resolve_mapping_account('INVENTORY_GENERAL');

  IF v_payment_terms = 'cash' THEN
    v_cash_id := resolve_mapping_account('PURCHASE_CASH_OUT');
  ELSE
    v_ap_id   := resolve_mapping_account('PURCHASE_PAYABLE');
  END IF;

  v_entry_no := next_journal_entry_number(
                  COALESCE((NEW).received_date, (NEW).created_at::date));

  -- F-S26-AC-09 : NON-PKP — fold vat_amount into inventory cost (SAK EMKM §4.1)
  v_inv_debit := v_subtotal + v_vat;

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

  -- DR Inventory (subtotal + non-recoverable VAT folded — ADR-003 NON-PKP)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_inv_id, v_inv_debit, 0,
      CASE WHEN v_vat > 0 THEN
        'Inventory received (incl. non-recoverable PPN supplier ' || v_vat::TEXT || ')'
      ELSE
        'Inventory received'
      END);

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
  'F-S26-AC-09 (ADR-003 NON-PKP) : fold vat_amount supplier dans INVENTORY_GENERAL '
  '(was DR INVENTORY + DR PURCHASE_VAT_INPUT separately). Le PPN 11% supplier '
  'non-récupérable est capitalisé dans le coût d''acquisition (SAK EMKM §4.1). '
  'Le compte 1151 PURCHASE_VAT_INPUT est désactivé en migration 1.H.';

REVOKE EXECUTE ON FUNCTION create_purchase_journal_entry() FROM PUBLIC;
