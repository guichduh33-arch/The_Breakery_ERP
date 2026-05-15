-- 20260519000044_backfill_production_records_actual_yield.sql
-- Session 15 / Phase 2.A — Backfill legacy production_records yield fields.
--
-- Decision D7 : historical rows (pre-Session-15) have expected_yield_qty IS NULL.
-- We populate them to a no-op state :
--   expected_yield_qty := quantity_produced
--   actual_yield_qty   := quantity_produced
-- This yields yield_variance_pct = 0 for all historical rows (no variance).
--
-- NO re-emission of journal entries — the legacy JE values were already based on
-- quantity_produced via stock_movements.quantity, which now == actual_yield.
--
-- Idempotent : the WHERE clause only touches NULL rows ; re-runs are no-ops.
-- Single batched UPDATE — production_records cardinality is small (< 10K rows
-- in any plausible bakery dataset).

UPDATE production_records
   SET expected_yield_qty = quantity_produced,
       actual_yield_qty   = quantity_produced,
       updated_at         = now()
 WHERE expected_yield_qty IS NULL;

-- Defensive : log how many rows were backfilled (visible in audit_log).
DO $$
DECLARE
  v_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM production_records
    WHERE expected_yield_qty = quantity_produced
      AND actual_yield_qty   = quantity_produced;
  RAISE NOTICE 'production_records yield backfill done. Rows with no-op yield = %', v_count;
END $$;
