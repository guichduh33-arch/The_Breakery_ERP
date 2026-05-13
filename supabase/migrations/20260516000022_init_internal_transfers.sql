-- 20260516000022_init_internal_transfers.sql
-- Session 12 / Phase 3 — Tables internal_transfers + transfer_items.
--
-- État du cycle : draft → pending → (in_transit) → received | cancelled.
--   - draft     : créé en mode brouillon (UI peut sauvegarder sans soumettre).
--   - pending   : soumis, en attente de réception.
--   - in_transit: réservé pour usage futur (mouvements physiques séparés) ; non émis par les RPCs MVP.
--   - received  : réceptionné côté destination, mouvements transfer_in/out émis.
--   - cancelled : annulé avant réception.
--
-- transfer_number format : TRF-YYYYMMDD-XXXX (compteur quotidien).
-- RLS lockdown : auth_read seulement, writes via RPCs SECURITY DEFINER uniquement.

CREATE TABLE internal_transfers (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number           TEXT         NOT NULL UNIQUE,
  from_section_id           UUID         NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  to_section_id             UUID         NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  status                    TEXT         NOT NULL DEFAULT 'pending'
                                            CHECK (status IN ('draft','pending','in_transit','received','cancelled')),
  notes                     TEXT,
  created_by                UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  approved_by               UUID         REFERENCES user_profiles(id) ON DELETE RESTRICT,
  transferred_at            TIMESTAMPTZ,
  received_at               TIMESTAMPTZ,
  created_idempotency_key   UUID         UNIQUE,
  received_idempotency_key  UUID         UNIQUE,
  metadata                  JSONB        NOT NULL DEFAULT '{}'::JSONB,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (from_section_id <> to_section_id)
);

CREATE INDEX idx_internal_transfers_status_created
  ON internal_transfers(status, created_at DESC);
CREATE INDEX idx_internal_transfers_from_section
  ON internal_transfers(from_section_id, created_at DESC);
CREATE INDEX idx_internal_transfers_to_section
  ON internal_transfers(to_section_id, created_at DESC);

CREATE TRIGGER internal_transfers_set_updated_at
  BEFORE UPDATE ON internal_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transfer_items (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id         UUID           NOT NULL REFERENCES internal_transfers(id) ON DELETE CASCADE,
  product_id          UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_requested  DECIMAL(10,3)  NOT NULL CHECK (quantity_requested > 0),
  quantity_received   DECIMAL(10,3)  CHECK (quantity_received IS NULL OR quantity_received >= 0),
  unit                TEXT           NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, product_id)
);

CREATE INDEX idx_transfer_items_transfer
  ON transfer_items(transfer_id);
CREATE INDEX idx_transfer_items_product
  ON transfer_items(product_id);

CREATE TRIGGER transfer_items_set_updated_at
  BEFORE UPDATE ON transfer_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Helper : générer le prochain transfer_number pour la date courante.
-- Lock advisory (clé = hashtext jour) pour éviter doublons en cas d'écriture concurrente.
CREATE OR REPLACE FUNCTION next_transfer_number()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_day TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD');
  v_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('next_transfer_number-' || v_day));
  SELECT COUNT(*) + 1 INTO v_count
    FROM internal_transfers
   WHERE transfer_number LIKE 'TRF-' || v_day || '-%';
  RETURN 'TRF-' || v_day || '-' || lpad(v_count::text, 4, '0');
END $$;

REVOKE EXECUTE ON FUNCTION next_transfer_number() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION next_transfer_number() FROM authenticated;
-- Appelable seulement par les RPCs SECURITY DEFINER owner.

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS : auth_read seulement, writes via RPCs SECURITY DEFINER uniquement.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE internal_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_items     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON internal_transfers FOR SELECT
  USING (is_authenticated() AND has_permission(auth.uid(), 'inventory.read'));

CREATE POLICY "auth_read" ON transfer_items FOR SELECT
  USING (is_authenticated() AND has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON internal_transfers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON transfer_items     FROM authenticated;

COMMENT ON TABLE internal_transfers IS
  'Phase 3 — Transferts inter-sections. Source de vérité du cycle de vie. '
  'Mouvements émis via record_stock_movement_v1 par receive_internal_transfer_v1.';
COMMENT ON COLUMN internal_transfers.status IS
  'draft (brouillon) / pending (soumis) / in_transit (réservé futur) / received (clos) / cancelled.';
COMMENT ON COLUMN internal_transfers.created_idempotency_key IS
  'Idempotency UUID pour create_internal_transfer_v1 replay-safe.';
COMMENT ON COLUMN internal_transfers.received_idempotency_key IS
  'Idempotency UUID pour receive_internal_transfer_v1 replay-safe.';
