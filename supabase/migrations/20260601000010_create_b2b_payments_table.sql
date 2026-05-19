-- 20260601000010_create_b2b_payments_table.sql
-- Session 24 / Phase 1.A.1 / migration 4
--
-- Ledger append-only des paiements B2B (parallèle à order_payments qui reste
-- dédié POS split-tender). RLS : SELECT pour authenticated, INSERT/UPDATE/DELETE
-- révoqués au niveau table — toutes les mutations passent par
-- record_b2b_payment_v1 (SECURITY DEFINER postgres).
--
-- Décision D1 (spec §2) : ledger immuable, audit trail source-of-truth.
-- Décision D3 : allocation JSONB = metadata audit only (snapshot au moment du
-- paiement) ; source-of-truth aggregée reste customers.b2b_current_balance.

-- Sequence pour numérotation human-readable (BP-YYYY-NNNN).
CREATE SEQUENCE IF NOT EXISTS b2b_payment_seq START 1;

CREATE TABLE b2b_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number   TEXT NOT NULL UNIQUE,                  -- format "BP-YYYY-NNNN"
  customer_id      UUID NOT NULL REFERENCES customers(id),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method           payment_method NOT NULL,                -- réutilise enum POS
  reference        TEXT,                                   -- réf bancaire/chèque
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       UUID NOT NULL REFERENCES user_profiles(id),
  idempotency_key  UUID UNIQUE,                            -- replay safety
  allocation       JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{invoice_id,amount_applied},...]
  journal_entry_id UUID REFERENCES journal_entries(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_b2b_payments_customer_paid_at ON b2b_payments (customer_id, paid_at DESC);
CREATE INDEX idx_b2b_payments_paid_at ON b2b_payments (paid_at DESC);

-- RLS : authenticated peut LIRE ; aucune POLICY write — les SECURITY DEFINER
-- RPCs bypassent RLS (et opèrent en tant que postgres owner).
ALTER TABLE b2b_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON b2b_payments FOR SELECT
  USING (is_authenticated());

-- Defense-in-depth (S20 pattern) : REVOKE explicite INSERT/UPDATE/DELETE pour
-- authenticated, anon, PUBLIC. Le SECURITY DEFINER bypass continue de marcher.
REVOKE INSERT, UPDATE, DELETE ON b2b_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON b2b_payments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON b2b_payments FROM PUBLIC;

COMMENT ON TABLE b2b_payments IS
  'Ledger append-only des paiements B2B. Mutable uniquement via record_b2b_payment_v1 '
  '(SECURITY DEFINER postgres). Pattern S22 stock_movements appliqué (S24).';

COMMENT ON COLUMN b2b_payments.payment_number IS
  'Numéro human-readable BP-YYYY-NNNN (sequence b2b_payment_seq).';

COMMENT ON COLUMN b2b_payments.allocation IS
  'Metadata audit only. Source-of-truth aggregée = customers.b2b_current_balance. '
  'Allocation per-invoice = backlog S26+ (Comptable Cockpit).';

COMMENT ON COLUMN b2b_payments.journal_entry_id IS
  'FK vers le JE émis (DR Cash/Bank / CR B2B_AR). Renseigné par record_b2b_payment_v1 '
  'après création du JE.';

COMMENT ON COLUMN b2b_payments.idempotency_key IS
  'UNIQUE — clé fournie par le client pour replay safe. RPC retourne le row '
  'existant si replay détecté.';
