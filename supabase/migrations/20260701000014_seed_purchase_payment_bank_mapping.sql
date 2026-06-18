-- 20260701000014_seed_purchase_payment_bank_mapping.sql
-- Session 46 / Wave A5 (part 1) — Seed PURCHASE_PAYMENT_BANK mapping.
--
-- record_po_payment_v1 and the redesigned create_purchase_journal_entry
-- both resolve a credit account for non-cash payments via:
--   resolve_mapping_account('PURCHASE_PAYMENT_BANK')
--
-- Decision A1 (resolved live, spec §5 open-question #1):
--   Debit  = PURCHASE_PAYABLE → account 2141 (already seeded).
--   Credit = PURCHASE_PAYMENT_BANK → account 1112 (Bank - Operating).
--
-- The mapping key is dedicated to Purchasing (not reused from B2B_PAYMENT_BANK)
-- to keep AP-specific bank movements distinct from AR-side receipts in the GL.
--
-- Table shape verified from migration 20260601000010 + accounting_mappings usage:
--   accounting_mappings(mapping_key TEXT PK, account_code TEXT, is_active BOOLEAN)
-- The FK is accounting_mappings.account_code → accounts.code.
--
-- ON CONFLICT DO NOTHING: idempotent re-run (e.g., after pgTAP rollback).

INSERT INTO accounting_mappings (mapping_key, account_code, is_active)
VALUES ('PURCHASE_PAYMENT_BANK', '1112', true)
ON CONFLICT (mapping_key) DO NOTHING;

COMMENT ON TABLE accounting_mappings IS
  'Extended S46: PURCHASE_PAYMENT_BANK → account 1112 (Bank - Operating) '
  'added for PO payment JE credit side (non-cash payments).';
