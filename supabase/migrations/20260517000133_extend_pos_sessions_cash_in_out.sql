-- Session 13 / Phase 3.C — Migration 133
-- Extend pos_sessions with cash-in/out aggregates + variance + closing notes.
-- Reuses the existing `expected_cash` column.

ALTER TABLE pos_sessions
  ADD COLUMN IF NOT EXISTS cash_in_total  NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_out_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS variance_total NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS closing_notes  TEXT;

ALTER TABLE pos_sessions
  ADD CONSTRAINT pos_sessions_cash_in_total_nonneg
    CHECK (cash_in_total >= 0);

ALTER TABLE pos_sessions
  ADD CONSTRAINT pos_sessions_cash_out_total_nonneg
    CHECK (cash_out_total >= 0);

COMMENT ON COLUMN pos_sessions.cash_in_total  IS 'Sum of mid-shift cash-in movements for this session (replenishments, top-ups).';
COMMENT ON COLUMN pos_sessions.cash_out_total IS 'Sum of mid-shift cash-out movements for this session (drops, withdrawals).';
COMMENT ON COLUMN pos_sessions.variance_total IS 'counted_cash − expected_cash on close. Positive = over, negative = short. NULL while session is open.';
COMMENT ON COLUMN pos_sessions.closing_notes  IS 'Free-text notes recorded at close (e.g. variance explanation, manager override reason).';
