-- 20260517000120_init_expenses.sql
-- Session 13 / Phase 3.B / Migration 120 : init Expenses module.
--
-- Creates :
--   - expense_categories (12 seeded, each FK to accounts via account_code lookup)
--   - expenses (main ledger) with EXP-YYYYMMDD-NNNN sequence
--   - next_expense_number() helper
--   - RLS policies (SELECT auth, INSERT/UPDATE manager+ or own draft)
--   - perm inserts (expenses.pay, expenses.manage) — already-seeded perms left untouched
--   - role_permissions grants for new perms
--   - accounting_mappings inserts (EXPENSE_AP, EXPENSE_CASH_OUT, EXPENSE_VAT_INPUT)
--
-- See sub-plan : docs/workplan/plans/2026-05-13-session-13-phase-3.B-expenses.md
-- Wave-3 deviations : docs/workplan/refs/2026-05-14-session-13-wave-3-deviations.md

BEGIN;

-- =============================================================================
-- 0. Mappings (expense-specific) — additive INSERT, do NOT modify 1.A migration
-- =============================================================================

INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active)
VALUES
  ('EXPENSE_AP',         '2141', 'Expense on credit -> CR AP',                       true),
  ('EXPENSE_CASH_OUT',   '1110', 'Expense paid cash/transfer/card -> CR Cash on Hand', true),
  ('EXPENSE_VAT_INPUT',  '1151', 'Expense VAT component -> DR VAT Input',            true)
ON CONFLICT (mapping_key) DO NOTHING;

-- =============================================================================
-- 1. expense_categories
-- =============================================================================

CREATE TABLE IF NOT EXISTS expense_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  account_id  UUID NOT NULL REFERENCES accounts(id),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_active
  ON expense_categories (is_active) WHERE is_active = true;

COMMENT ON TABLE expense_categories IS
  'Phase 3.B : nomenclature of operational expense categories. account_id pilots the debit account of the JE generated at expense approval.';

-- Seed 12 standard categories. account_id resolved via code lookup so the seed
-- is robust to UUIDs being random per environment.
INSERT INTO expense_categories (code, name, account_id, is_active)
SELECT v.code, v.name, a.id, true
FROM (VALUES
    ('UTILITIES',   'Utilities',    '6113'),
    ('RENT',        'Rent',         '6112'),
    ('SALARIES',    'Salaries',     '6111'),
    ('SUPPLIES',    'Supplies',     '6114'),
    ('MAINTENANCE', 'Maintenance',  '6116'),
    ('MARKETING',   'Marketing',    '6115'),
    ('TRANSPORT',   'Transport',    '6190'),
    ('INSURANCE',   'Insurance',    '6190'),
    ('TAX',         'Tax',          '6190'),
    ('BANK_FEES',   'Bank Fees',    '6190'),
    ('OFFICE',      'Office',       '6190'),
    ('OTHER',       'Other',        '6190')
  ) AS v(code, name, account_code)
JOIN accounts a ON a.code = v.account_code
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 2. expenses
-- =============================================================================

CREATE TABLE IF NOT EXISTS expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number  TEXT NOT NULL UNIQUE,
  category_id     UUID NOT NULL REFERENCES expense_categories(id),
  amount          DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  vat_amount      DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  payment_method  TEXT NOT NULL CHECK (payment_method IN ('cash','transfer','card','credit')),
  description     TEXT NOT NULL,
  vendor_name     TEXT,
  expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_url     TEXT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','paid')),
  created_by      UUID REFERENCES user_profiles(id),
  submitted_by    UUID REFERENCES user_profiles(id),
  approved_by     UUID REFERENCES user_profiles(id),
  paid_by         UUID REFERENCES user_profiles(id),
  approval_notes  TEXT,
  rejected_reason TEXT,
  je_id           UUID REFERENCES journal_entries(id),
  payment_je_id   UUID REFERENCES journal_entries(id),
  idempotency_key UUID UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_expenses_status        ON expenses (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date  ON expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category      ON expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_created_by    ON expenses (created_by);

COMMENT ON TABLE expenses IS
  'Phase 3.B : operational expense ledger. Workflow draft->submitted->approved->paid (or rejected). JE auto-emitted at approval via approve_expense_v1.';

-- updated_at trigger (re-use generic helper if available, else inline).
CREATE OR REPLACE FUNCTION expenses_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_expenses_set_updated_at ON expenses;
CREATE TRIGGER trg_expenses_set_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_set_updated_at();

DROP TRIGGER IF EXISTS trg_expense_categories_set_updated_at ON expense_categories;
CREATE TRIGGER trg_expense_categories_set_updated_at
  BEFORE UPDATE ON expense_categories
  FOR EACH ROW EXECUTE FUNCTION expenses_set_updated_at();

-- =============================================================================
-- 3. next_expense_number() helper — EXP-YYYYMMDD-NNNN monotonic per day
-- =============================================================================

CREATE OR REPLACE FUNCTION next_expense_number(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT := 'EXP-' || to_char(p_date, 'YYYYMMDD') || '-';
  v_seq    INT;
BEGIN
  SELECT COALESCE(MAX( (substring(expense_number FROM 14 FOR 4))::INT ), 0) + 1
    INTO v_seq
    FROM expenses
    WHERE expense_number LIKE v_prefix || '%';
  RETURN v_prefix || lpad(v_seq::TEXT, 4, '0');
END $$;

COMMENT ON FUNCTION next_expense_number(DATE) IS
  'Phase 3.B : returns next EXP-YYYYMMDD-NNNN for the given date. Monotonic per day. Not concurrency-safe under race ; rely on UNIQUE on expense_number + retry.';

-- =============================================================================
-- 4. RLS
-- =============================================================================

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses           ENABLE ROW LEVEL SECURITY;

-- Categories : SELECT for all auth users, writes via SECURITY DEFINER service path.
DROP POLICY IF EXISTS expense_categories_select_auth ON expense_categories;
CREATE POLICY expense_categories_select_auth ON expense_categories
  FOR SELECT TO authenticated USING (true);

-- Expenses : SELECT for all auth users (reads), INSERT/UPDATE gated by perm or ownership.
DROP POLICY IF EXISTS expenses_select_auth ON expenses;
CREATE POLICY expenses_select_auth ON expenses
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

DROP POLICY IF EXISTS expenses_insert_creator_or_manager ON expenses;
CREATE POLICY expenses_insert_creator_or_manager ON expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    has_permission(auth.uid(), 'expenses.create')
    OR has_permission(auth.uid(), 'expenses.manage')
  );

DROP POLICY IF EXISTS expenses_update_owner_or_manager ON expenses;
CREATE POLICY expenses_update_owner_or_manager ON expenses
  FOR UPDATE TO authenticated
  USING (
    -- Manager+ can update anything ; creator can update only own draft.
    has_permission(auth.uid(), 'expenses.manage')
    OR (
      status = 'draft'
      AND created_by = (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  )
  WITH CHECK (
    has_permission(auth.uid(), 'expenses.manage')
    OR (
      status = 'draft'
      AND created_by = (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid() LIMIT 1)
    )
  );

-- =============================================================================
-- 5. Permissions — additive
-- =============================================================================

INSERT INTO permissions (code, module, action, description) VALUES
  ('expenses.pay',    'expenses', 'update', 'Mark expense as paid (manager+).'),
  ('expenses.manage', 'expenses', 'update', 'Manage all expenses regardless of ownership (manager+).')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('SUPER_ADMIN', 'expenses.pay',    true),
  ('ADMIN',       'expenses.pay',    true),
  ('MANAGER',     'expenses.pay',    true),
  ('SUPER_ADMIN', 'expenses.manage', true),
  ('ADMIN',       'expenses.manage', true),
  ('MANAGER',     'expenses.manage', true)
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
