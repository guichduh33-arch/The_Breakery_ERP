-- 20260512000001_extend_order_payments_reference.sql
-- Session 10 — split payment.
-- Add `reference` column on order_payments to capture per-tender external auth IDs
-- (card auth code, qris reference, transfer ID, etc.). NULL pour cash.

ALTER TABLE order_payments
  ADD COLUMN IF NOT EXISTS reference TEXT;

COMMENT ON COLUMN order_payments.reference IS
  'Session 10: external reference for the tender (card auth code, qris ref, transfer ID). NULL for cash.';
