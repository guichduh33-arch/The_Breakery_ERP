-- Session 13 / Phase 3.C — Migration 130
-- Extend customers table with B2B-specific fields. Existing customer_type
-- enum already supports 'retail' | 'b2b'. These columns are nullable so
-- retail rows remain unaffected.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS b2b_company_name        TEXT,
  ADD COLUMN IF NOT EXISTS b2b_tax_id              TEXT,
  ADD COLUMN IF NOT EXISTS b2b_payment_terms_days  INT,
  ADD COLUMN IF NOT EXISTS b2b_credit_limit        NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS b2b_current_balance     NUMERIC(14,2) NOT NULL DEFAULT 0;

ALTER TABLE customers
  ADD CONSTRAINT customers_b2b_payment_terms_positive
    CHECK (b2b_payment_terms_days IS NULL OR b2b_payment_terms_days >= 0);

ALTER TABLE customers
  ADD CONSTRAINT customers_b2b_credit_limit_positive
    CHECK (b2b_credit_limit IS NULL OR b2b_credit_limit >= 0);

ALTER TABLE customers
  ADD CONSTRAINT customers_b2b_current_balance_nonneg
    CHECK (b2b_current_balance >= 0);

CREATE INDEX IF NOT EXISTS idx_customers_b2b_type
  ON customers (customer_type)
  WHERE customer_type = 'b2b' AND deleted_at IS NULL;

-- Drop legacy CHECK that pinned customer_type to 'retail' even though the
-- customer_type enum supports 'b2b' (V2 carryover). The enum guarantees
-- validity already.
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_customer_type_check;

COMMENT ON COLUMN customers.b2b_company_name        IS 'B2B legal entity name (PT/CV); separate from contact name.';
COMMENT ON COLUMN customers.b2b_tax_id              IS 'NPWP or equivalent tax ID for invoicing.';
COMMENT ON COLUMN customers.b2b_payment_terms_days  IS 'Net payment terms in days (e.g. 30, 60).';
COMMENT ON COLUMN customers.b2b_credit_limit        IS 'Maximum outstanding AR allowed before refusing new credit orders. NULL = unlimited.';
COMMENT ON COLUMN customers.b2b_current_balance     IS 'Cached AR outstanding (updated on B2B order paid/voided). Source of truth lives in B2B_AR ledger.';
