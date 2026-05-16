-- 20260519000040_extend_production_records_yield.sql
-- Session 15 / Phase 2.A — F5 Yield tracking : extend `production_records`.
--
-- Decision D5 : JE source-of-truth = actual_yield_qty (not quantity_produced).
-- Decision D6 : variance modal threshold default 15.00%, configurable.
-- Decision D7 : legacy rows backfilled to actual = produced (no-op JE), see 044.
--
-- Adds :
--   - expected_yield_qty   : what the manager planned (default = quantity_produced).
--   - actual_yield_qty     : what was actually weighed out (default = quantity_produced).
--   - yield_variance_pct   : GENERATED column = (actual - expected) / expected.
--                            Nullable when expected IS NULL or zero.
--   - yield_variance_reason: REQUIRED textual justification when |variance| > threshold
--                            (enforced at UI level + RPC ; CHECK guarantees min length
--                            when present).
--
-- All four columns nullable for backward compat with legacy rows ; the v_42
-- bump of record_production_v1 populates expected/actual at insert time.

ALTER TABLE production_records
  ADD COLUMN IF NOT EXISTS expected_yield_qty    DECIMAL(10,3),
  ADD COLUMN IF NOT EXISTS actual_yield_qty      DECIMAL(10,3),
  ADD COLUMN IF NOT EXISTS yield_variance_reason TEXT;

-- yield_variance_pct must be added separately because generated columns can't be
-- ADDed alongside non-generated columns in the same ALTER TABLE statement on some
-- engines. Use a DO block for idempotent add.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'production_records' AND column_name = 'yield_variance_pct'
  ) THEN
    ALTER TABLE production_records
      ADD COLUMN yield_variance_pct DECIMAL(7,4)
      GENERATED ALWAYS AS (
        CASE
          WHEN expected_yield_qty IS NULL OR expected_yield_qty = 0 THEN NULL
          ELSE (actual_yield_qty - expected_yield_qty) / expected_yield_qty
        END
      ) STORED;
  END IF;
END $$;

-- Check : reason must be at least 5 trimmed chars when present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'production_records_yield_reason_min_length'
  ) THEN
    ALTER TABLE production_records
      ADD CONSTRAINT production_records_yield_reason_min_length
      CHECK (yield_variance_reason IS NULL OR length(trim(yield_variance_reason)) >= 5);
  END IF;
END $$;

-- Check : actual_yield_qty must be non-negative when present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'production_records_actual_yield_non_negative'
  ) THEN
    ALTER TABLE production_records
      ADD CONSTRAINT production_records_actual_yield_non_negative
      CHECK (actual_yield_qty IS NULL OR actual_yield_qty >= 0);
  END IF;
END $$;

-- Check : expected_yield_qty must be positive when present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'production_records_expected_yield_positive'
  ) THEN
    ALTER TABLE production_records
      ADD CONSTRAINT production_records_expected_yield_positive
      CHECK (expected_yield_qty IS NULL OR expected_yield_qty > 0);
  END IF;
END $$;

COMMENT ON COLUMN production_records.expected_yield_qty IS
  'Session 15 D5/D6 — planned output for this batch (set by record_production_v1 '
  'from p_quantity_produced ; matches the operator''s recipe-scaled expectation). '
  'NULL on legacy rows (backfill migration 044 populates them).';
COMMENT ON COLUMN production_records.actual_yield_qty IS
  'Session 15 D5 — measured output after the bake. Drives Dr Inventory finished-goods '
  'JE via stock_movements.quantity in record_production_v1. Defaults to '
  'quantity_produced when the operator does not weigh separately (no-op case).';
COMMENT ON COLUMN production_records.yield_variance_pct IS
  'Session 15 D5 — GENERATED ALWAYS AS (actual - expected) / expected, STORED. '
  'Negative = under-yield (loss), positive = over-yield. Used by reports and the '
  'variance modal (threshold business_config.production_yield_variance_threshold_pct).';
COMMENT ON COLUMN production_records.yield_variance_reason IS
  'Session 15 D6 — free-text justification provided by the operator when '
  '|variance_pct| > business_config.production_yield_variance_threshold_pct. '
  'Min 5 chars when set (CHECK production_records_yield_reason_min_length).';
