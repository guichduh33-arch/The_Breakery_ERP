-- 20260505010001_init_customers.sql
-- Session 3 / migration 1 : table customers + RLS + index
-- v1 guard CHECK (customer_type = 'retail') empêche b2b jusqu'à session 9

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE customer_type   AS ENUM ('retail', 'b2b');
CREATE TYPE loyalty_txn_type AS ENUM ('earn', 'redeem', 'adjust');

CREATE TABLE customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  customer_type   customer_type NOT NULL DEFAULT 'retail'
                  CHECK (customer_type = 'retail'),
  loyalty_points  INTEGER NOT NULL DEFAULT 0
                  CHECK (loyalty_points >= 0),
  lifetime_points INTEGER NOT NULL DEFAULT 0
                  CHECK (lifetime_points >= 0),
  total_spent     DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_visits    INTEGER NOT NULL DEFAULT 0,
  last_visit_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_customers_phone       ON customers(phone)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_name_trgm   ON customers USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_loyalty_pts ON customers(loyalty_points DESC)
  WHERE deleted_at IS NULL AND loyalty_points > 0;

CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON customers FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);

CREATE POLICY "auth_insert_retail" ON customers FOR INSERT
  WITH CHECK (is_authenticated() AND customer_type = 'retail');

COMMENT ON TABLE customers IS
  'Customers v1 (retail only). B2B guard lifted session 9.';
COMMENT ON COLUMN customers.loyalty_points IS
  'Current redeemable balance. Updated by complete_order_with_payment SECURITY DEFINER.';
COMMENT ON COLUMN customers.lifetime_points IS
  'Cumulative earned points (never decremented). Drives tier calculation.';
