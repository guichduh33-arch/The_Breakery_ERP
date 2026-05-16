-- 20260519000010_extend_production_records_materials_breakdown.sql
-- Session 15 / Phase 1.A — production_records.materials_breakdown JSONB.
--
-- Note on ordering : this migration is numerically AFTER 000006 (which
-- references materials_breakdown), but per the Phase 1.A plan it's the
-- canonical "add this column" migration. Migration 000006 defensively
-- adds it via `IF NOT EXISTS` to be self-contained. Applying the column
-- here too remains idempotent and keeps the numeric ordering predictable
-- for downstream sessions.

ALTER TABLE production_records
  ADD COLUMN IF NOT EXISTS materials_breakdown JSONB;

COMMENT ON COLUMN production_records.materials_breakdown IS
  'Session 15 — Phase 1.A. JSONB array of {material_id, material_name, leaf, '
  'qty_per_unit, total_consumed, unit, depth, sub_path, is_intermediate}. '
  'Captures the full cascade breakdown at production time for audit and UI display.';

CREATE INDEX IF NOT EXISTS idx_production_records_materials_breakdown
  ON production_records USING GIN (materials_breakdown)
  WHERE materials_breakdown IS NOT NULL;
