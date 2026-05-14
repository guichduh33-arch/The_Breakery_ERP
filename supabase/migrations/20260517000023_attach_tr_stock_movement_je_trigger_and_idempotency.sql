-- 20260517000023_attach_tr_stock_movement_je_trigger_and_idempotency.sql
-- Session 13 / Phase 1.A / [m4] split 3/3 :
--   Attach tr_stock_movement_je() as trigger `tr_20_je_emit` AFTER INSERT on
--   stock_movements + add UNIQUE constraint for JE idempotency keyed by
--   (reference_type, reference_id, COALESCE(metadata->>'movement_type', '')).
--
-- M1 numeric prefix convention :
--   `_10_*` reserved for future BEFORE-INSERT auditors.
--   `_20_je_emit` (this trigger) — the ONLY AFTER-INSERT trigger on stock_movements.
--   `_30_*` reserved for downstream consumers.
-- This encodes lexicographic firing order — pg_trigger names are scanned alphabetically.
-- pgTAP T_TRIGGER_ORDER_STOCK_MOVEMENTS asserts the invariant in accounting.test.sql.
--
-- Decision D20 : no V2 trigger to drop (verified `create_stock_movement_journal_entry` absent).
-- `tr_20_je_emit` is the canonical single source of truth.

-- Widen reference_type CHECK to accept 'stock_movement' (added by tr_20_je_emit).
ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_reference_type_check;
ALTER TABLE journal_entries
  ADD  CONSTRAINT journal_entries_reference_type_check
  CHECK (reference_type IS NULL OR reference_type IN (
    'sale','sale_void','sale_refund',
    'purchase','purchase_return','purchase_payment',
    'expense','expense_payment',
    'shift_close',
    'adjustment','waste','opname','production','transfer',
    'manual','pos_outstanding','pos_outstanding_payment',
    'stock_movement',
    'void','refund'  -- legacy aliases (transition)
  ));

-- UNIQUE for JE idempotency. Keyed by movement_type discriminator so multiple
-- distinct types referencing the same stock_movement row (impossible in practice,
-- but reserved for future) stay disjoint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = 'journal_entries_je_idempotency_uniq'
  ) THEN
    CREATE UNIQUE INDEX journal_entries_je_idempotency_uniq
      ON journal_entries (
        reference_type,
        reference_id,
        COALESCE(metadata->>'movement_type', '')
      ) WHERE reference_id IS NOT NULL;
  END IF;
END $$;

COMMENT ON INDEX journal_entries_je_idempotency_uniq IS
  'D11/D14/D20 — guards against double-fire on (reference_type, reference_id, movement_type). '
  'Belt-and-braces ; pre-SELECT in triggers/RPCs is the primary guard.';

-- Attach the trigger. Drop first to be idempotent on re-reset.
DROP TRIGGER IF EXISTS tr_20_je_emit ON stock_movements;
CREATE TRIGGER tr_20_je_emit
  AFTER INSERT ON stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION tr_stock_movement_je();

COMMENT ON TRIGGER tr_20_je_emit ON stock_movements IS
  'M1 (Decision Pack 2026-05-13). Numeric prefix _20_ encodes AFTER INSERT firing order. '
  'ONLY trigger that writes journal_entries from stock_movements. FIFO lot resolution is '
  'handled UPFRONT inside record_stock_movement_v1, NOT via trigger.';

COMMENT ON TABLE stock_movements IS
  'Append-only ledger. The only AFTER INSERT trigger permitted is tr_20_je_emit '
  '(journal entry emission). FIFO lot resolution is handled UPFRONT inside '
  'record_stock_movement_v1, not via trigger. No UPDATE/DELETE triggers permitted on this table.';
