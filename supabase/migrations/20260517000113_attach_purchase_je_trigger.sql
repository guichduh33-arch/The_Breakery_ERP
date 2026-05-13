-- 20260517000113_attach_purchase_je_trigger.sql
-- Session 13 / Phase 3.A — attach existing create_purchase_journal_entry()
-- trigger function (created in Phase 1.A migration 000011) to the brand-new
-- goods_receipt_notes table.
--
-- The trigger fires AFTER INSERT and posts the JE atomically:
--   DR INVENTORY_GENERAL   subtotal
--   DR PURCHASE_VAT_INPUT  vat_amount
--   CR PURCHASE_PAYABLE    total          (when payment_terms='credit')
--   CR PURCHASE_CASH_OUT   total          (when payment_terms='cash')
--
-- The function reads NEW.{subtotal, vat_amount, total, payment_terms,
-- received_date, received_by, grn_number}. All columns are present on
-- goods_receipt_notes (see migration 000110).

DROP TRIGGER IF EXISTS trg_create_purchase_je ON goods_receipt_notes;

CREATE TRIGGER trg_create_purchase_je
  AFTER INSERT ON goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION create_purchase_journal_entry();

COMMENT ON TRIGGER trg_create_purchase_je ON goods_receipt_notes IS
  'Session 13 — Phase 3.A. Posts balanced JE on GRN INSERT. Function is the '
  'shared create_purchase_journal_entry() from Phase 1.A migration 000011 — '
  'same contract used by future purchase_invoices when those land.';
