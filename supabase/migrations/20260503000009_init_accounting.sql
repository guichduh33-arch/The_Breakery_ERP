-- 20260503000009_init_accounting.sql
-- Decision §6 (option A): JE auto-trigger from session 1.
-- 3 tables + COA minimal + RLS policies.

CREATE TABLE accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  account_class   SMALLINT NOT NULL,            -- 1=Asset, 2=Liability, 3=Equity, 4=Revenue, 5=COGS, 6=Expense
  account_type    TEXT NOT NULL,                -- asset|liability|equity|revenue|expense
  balance_type    TEXT NOT NULL CHECK (balance_type IN ('debit','credit')),
  is_postable     BOOLEAN NOT NULL DEFAULT true,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);
CREATE INDEX idx_accounts_code ON accounts(code);

CREATE TABLE journal_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number    TEXT UNIQUE NOT NULL,
  entry_date      DATE NOT NULL,
  description     TEXT,
  reference_type  TEXT,                         -- sale|void|adjustment|manual
  reference_id    UUID,
  status          TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','locked')),
  total_debit     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_credit    DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES user_profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_je_entry_date ON journal_entries(entry_date);
CREATE INDEX idx_je_reference  ON journal_entries(reference_type, reference_id);

CREATE TABLE journal_entry_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id  UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id        UUID NOT NULL REFERENCES accounts(id),
  debit             DECIMAL(12,2) NOT NULL DEFAULT 0,
  credit            DECIMAL(12,2) NOT NULL DEFAULT 0,
  description       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ( (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0) )
);
CREATE INDEX idx_jel_journal ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_jel_account ON journal_entry_lines(account_id);

-- updated_at triggers (cohérence avec orders/products)
CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER journal_entries_set_updated_at
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- COA minimal seed (session 1)
INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active) VALUES
  ('1110', 'Cash on Hand',       1, 'asset',     'debit',  true, true, true),
  ('4100', 'Sales Revenue',      4, 'revenue',   'credit', true, true, true),
  ('2110', 'PB1 (10%) Payable',  2, 'liability', 'credit', true, true, true);

-- RLS
ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON accounts FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "auth_read" ON journal_entries FOR SELECT
  USING (is_authenticated());
CREATE POLICY "auth_read" ON journal_entry_lines FOR SELECT
  USING (is_authenticated());

-- Pas de policies WRITE: INSERT/UPDATE uniquement via trigger SECURITY DEFINER (000010)

COMMENT ON TABLE accounts            IS 'Chart of Accounts (COA) — comptes comptables postables';
COMMENT ON TABLE journal_entries     IS 'En-tête des écritures comptables (1 par sale/void)';
COMMENT ON TABLE journal_entry_lines IS 'Lignes d''écriture (debit XOR credit > 0, somme balanced)';
