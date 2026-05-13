-- 20260517000080_extend_promotions_schema_bogo_threshold.sql
-- Session 13 / Phase 2.C — Part 1/2 : enum extension only.
--
-- Postgres requires `ALTER TYPE … ADD VALUE` to be committed before the new
-- value can be referenced in a CHECK constraint expression. We therefore
-- split the schema change in two : enum first, then columns + CHECK in
-- migration 000081 (its own transaction).
--
-- See `docs/workplan/refs/2026-05-14-session-13-wave-2-deviations.md`
-- §D-W2-2C-06 for the split rationale.

ALTER TYPE promotion_type ADD VALUE IF NOT EXISTS 'threshold';
ALTER TYPE promotion_type ADD VALUE IF NOT EXISTS 'bundle';
