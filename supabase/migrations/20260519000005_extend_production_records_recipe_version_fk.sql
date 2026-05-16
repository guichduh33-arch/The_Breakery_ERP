-- 20260519000005_extend_production_records_recipe_version_fk.sql
-- Session 15 / Phase 1.A — production_records.recipe_version_id FK.
--
-- Decision D4 : production_records captures the recipe_versions row that was
-- current at the moment of production (anti-rétroactivité COGS). Nullable :
-- legacy rows (created before this migration) have no snapshot reference.
-- Future record_production_v1 will populate this on insert.

ALTER TABLE production_records
  ADD COLUMN IF NOT EXISTS recipe_version_id UUID
    REFERENCES recipe_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_records_recipe_version
  ON production_records(recipe_version_id)
  WHERE recipe_version_id IS NOT NULL;

COMMENT ON COLUMN production_records.recipe_version_id IS
  'Session 15 — Phase 1.A. FK to recipe_versions snapshot that was active at '
  'production time. NULL for legacy rows pre-session-15.';
