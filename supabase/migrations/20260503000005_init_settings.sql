-- 20260503000005_init_settings.sql
-- Phase 2 / migration 6 : settings + sequences + audit

CREATE TABLE business_config (
  id              SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  name            TEXT NOT NULL DEFAULT 'The Breakery',
  currency        TEXT NOT NULL DEFAULT 'IDR',
  tax_rate        DECIMAL(5,4) NOT NULL DEFAULT 0.1000,           -- PB1 10%
  tax_inclusive   BOOLEAN NOT NULL DEFAULT true,
  fiscal_address  TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Makassar',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER business_config_set_updated_at
  BEFORE UPDATE ON business_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_sequences (
  date            DATE PRIMARY KEY,
  last_number     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  actor_id        UUID REFERENCES user_profiles(id),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, created_at DESC);

COMMENT ON TABLE business_config  IS 'Singleton config business (PB1, devise, timezone)';
COMMENT ON TABLE order_sequences  IS 'Compteur quotidien pour order_number (#0001 reset chaque jour)';
COMMENT ON TABLE audit_logs       IS 'Append-only audit trail';
