-- 20260519000101_extend_production_records_batch_fk.sql
-- Session 15 / Phase 4.A — Wire production_records back to its parent batch.
--
-- batch_id is OPTIONAL (legacy single-recipe rows produced via record_production_v1
-- have no batch and stay NULL). When set, it FK-links the row to the
-- production_batches header created by record_batch_production_v1.
--
-- ON DELETE SET NULL : if a batch is deleted (only allowed via SECURITY DEFINER
-- RPC ; not currently exposed), the child production_records survive as
-- standalone rows.

ALTER TABLE production_records
  ADD COLUMN batch_id UUID REFERENCES production_batches(id) ON DELETE SET NULL;

CREATE INDEX idx_production_records_batch
  ON production_records(batch_id)
  WHERE batch_id IS NOT NULL;

COMMENT ON COLUMN production_records.batch_id IS
  'Session 15 / Phase 4.A. Optional FK to production_batches header. NULL = '
  'standalone production batch (legacy or single-recipe). Populated by '
  'record_batch_production_v1.';
