-- 20260517000061_init_production_records.sql
-- Session 13 / Phase 2.A — Production + Recipes : init `production_records` table.
--
-- Module 15. One row per fournée (production batch). Captures :
--   - what was produced (product_id, quantity_produced, quantity_waste)
--   - where  (section_id)
--   - by whom (staff_id)
--   - when   (production_date)
--   - lifecycle flags (materials_consumed, stock_updated, je_posted, reverted_at)
--
-- Decisions (sub-plan §2) :
--   - D-2A-1  : DECIMAL(10,3) for quantities.
--   - D-2A-4  : idempotency_key UUID UNIQUE for record_production_v1 replay.
--   - D-2A-13 : production_number = 'PROD-YYYYMMDD-NNNN' via sequence + date prefix.
--   - D-2A-9  : reverted_at / reverted_by populated by revert_production_v1.
--
-- RLS : authenticated SELECT (inventory.read) ; INSERT/UPDATE/DELETE via
-- SECURITY DEFINER RPCs only (record_production_v1, revert_production_v1).

CREATE SEQUENCE IF NOT EXISTS production_records_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE production_records (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  production_number   TEXT           NOT NULL UNIQUE
                                       CHECK (production_number ~ '^PROD-[0-9]{8}-[0-9]{4,}$'),
  product_id          UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_produced   DECIMAL(10,3)  NOT NULL CHECK (quantity_produced > 0),
  quantity_waste      DECIMAL(10,3)  NOT NULL DEFAULT 0 CHECK (quantity_waste >= 0),
  production_date     TIMESTAMPTZ    NOT NULL DEFAULT now(),
  section_id          UUID           REFERENCES sections(id) ON DELETE SET NULL,
  staff_id            UUID           REFERENCES user_profiles(id) ON DELETE SET NULL,
  batch_number        TEXT,
  notes               TEXT,
  materials_consumed  BOOLEAN        NOT NULL DEFAULT FALSE,
  stock_updated       BOOLEAN        NOT NULL DEFAULT FALSE,
  je_posted           BOOLEAN        NOT NULL DEFAULT FALSE,
  idempotency_key     UUID           UNIQUE,
  reverted_at         TIMESTAMPTZ,
  reverted_by         UUID           REFERENCES user_profiles(id) ON DELETE SET NULL,
  reverted_reason     TEXT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_production_records_product_date
  ON production_records(product_id, production_date DESC);

CREATE INDEX idx_production_records_date
  ON production_records(production_date DESC);

CREATE INDEX idx_production_records_section
  ON production_records(section_id, production_date DESC)
  WHERE section_id IS NOT NULL;

CREATE INDEX idx_production_records_active
  ON production_records(production_date DESC)
  WHERE reverted_at IS NULL;

CREATE TRIGGER production_records_set_updated_at
  BEFORE UPDATE ON production_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE production_records IS
  'Session 13 — Module 15. One row per production batch. Lifecycle flags '
  '(materials_consumed, stock_updated, je_posted) flipped by record_production_v1. '
  'reverted_at flipped by revert_production_v1 (soft-revert, audit preserved). '
  'RLS lockdown — writes via SECURITY DEFINER RPCs.';
COMMENT ON COLUMN production_records.production_number IS
  'Human-readable batch ID PROD-YYYYMMDD-NNNN (sequence-driven, monotonic).';
COMMENT ON COLUMN production_records.idempotency_key IS
  'UNIQUE key for record_production_v1 replay safety. Same key returns the '
  'existing row instead of double-spending materials.';
COMMENT ON COLUMN production_records.reverted_at IS
  'Set by revert_production_v1. Soft-revert : row preserved, ledger reversed '
  'via counter-movements + counter-JE.';

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS : authenticated SELECT (inventory.read), writes via SECURITY DEFINER RPCs.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON production_records FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON production_records FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON production_records FROM anon;

-- Allow SELECT on the sequence for clients that read currval (we won't ; RPCs use it).
REVOKE ALL ON SEQUENCE production_records_seq FROM authenticated;
REVOKE ALL ON SEQUENCE production_records_seq FROM anon;
