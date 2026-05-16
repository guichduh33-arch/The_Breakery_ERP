-- 20260519000100_init_production_batches.sql
-- Session 15 / Phase 4.A — Batch production atomic header.
--
-- One row per batch — a collection of N production_records executed atomically
-- under a single SECURITY DEFINER call (record_batch_production_v1). The batch
-- row is the parent ; each child production_records.batch_id FK-links it
-- (added in 20260519000101).
--
-- Decisions (Spec 2026-05-15 §D10) :
--   - Status is a 3-state lifecycle : 'open' → 'completed' | 'cancelled'.
--     'open' only exists transiently inside record_batch_production_v1 — if
--     any child production_records call raises, the whole transaction rolls
--     back (no batch row persisted). On success the RPC flips to 'completed'.
--   - batch_number follows the same PROD-style pattern as production_records :
--     'BATCH-YYYYMMDD-NNNN' driven by a dedicated sequence (monotonic).
--   - idempotency_key UNIQUE allows replay protection on the batch itself ;
--     a replayed call short-circuits and returns the existing payload without
--     re-executing any child production_records.
--   - staff_id mirrors production_records.staff_id semantics (FK user_profiles,
--     ON DELETE SET NULL so a deleted staff doesn't break audit trails).
--   - scheduled_at NULL = on-demand batch ; Phase 4.B will populate it for
--     scheduled batches.

CREATE SEQUENCE IF NOT EXISTS production_batches_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE production_batches (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number    TEXT         NOT NULL UNIQUE
                                 CHECK (batch_number ~ '^BATCH-[0-9]{8}-[0-9]{4,}$'),
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  staff_id        UUID         REFERENCES user_profiles(id) ON DELETE SET NULL,
  status          TEXT         NOT NULL DEFAULT 'open'
                                 CHECK (status IN ('open','completed','cancelled')),
  notes           TEXT,
  idempotency_key UUID         UNIQUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_production_batches_status_started
  ON production_batches(status, started_at DESC);

CREATE INDEX idx_production_batches_scheduled
  ON production_batches(scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE TRIGGER production_batches_set_updated_at
  BEFORE UPDATE ON production_batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE production_batches IS
  'Session 15 / Phase 4.A. Atomic header for a multi-recipe production batch. '
  'One row groups N production_records inserted under a single transaction by '
  'record_batch_production_v1. RLS — read via inventory.read, writes via '
  'SECURITY DEFINER RPC only.';

COMMENT ON COLUMN production_batches.batch_number IS
  'Human-readable batch ID BATCH-YYYYMMDD-NNNN (sequence-driven, monotonic).';
COMMENT ON COLUMN production_batches.status IS
  'Lifecycle : open (transient, only inside the RPC) → completed | cancelled.';
COMMENT ON COLUMN production_batches.idempotency_key IS
  'UNIQUE key for record_batch_production_v1 replay safety — same key returns '
  'the existing payload instead of doubling materials consumption.';
COMMENT ON COLUMN production_batches.scheduled_at IS
  'Optional planned start timestamp (Phase 4.B). NULL = on-demand batch.';

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS : authenticated SELECT (inventory.read), writes via SECURITY DEFINER RPCs.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON production_batches FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON production_batches FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON production_batches FROM anon;

REVOKE ALL ON SEQUENCE production_batches_seq FROM authenticated;
REVOKE ALL ON SEQUENCE production_batches_seq FROM anon;
