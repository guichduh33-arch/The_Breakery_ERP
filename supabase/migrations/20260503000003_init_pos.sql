-- 20260503000003_init_pos.sql
-- Phase 2 / migration 4 : tables POS

-- POS SESSIONS (shift)
CREATE TABLE pos_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by       UUID NOT NULL REFERENCES user_profiles(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash    DECIMAL(12,2) NOT NULL CHECK (opening_cash >= 0),
  opening_notes   TEXT,
  closed_at       TIMESTAMPTZ,
  closed_by       UUID REFERENCES user_profiles(id),
  closing_cash    DECIMAL(12,2) CHECK (closing_cash IS NULL OR closing_cash >= 0),
  expected_cash   DECIMAL(12,2),
  status          shift_status NOT NULL DEFAULT 'open',
  CONSTRAINT one_open_session_per_user EXCLUDE USING gist (
    opened_by WITH =
  ) WHERE (status = 'open')
);

CREATE INDEX idx_pos_sessions_open ON pos_sessions(opened_by) WHERE status = 'open';

-- ORDERS
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    TEXT UNIQUE NOT NULL,
  session_id      UUID NOT NULL REFERENCES pos_sessions(id),
  served_by       UUID NOT NULL REFERENCES user_profiles(id),
  order_type      order_type NOT NULL DEFAULT 'dine_in',
  status          order_status NOT NULL DEFAULT 'draft',
  subtotal        DECIMAL(12,2) NOT NULL,
  tax_amount      DECIMAL(12,2) NOT NULL,
  total           DECIMAL(12,2) NOT NULL,
  idempotency_key UUID UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

CREATE INDEX idx_orders_session ON orders(session_id, created_at DESC);
CREATE INDEX idx_orders_paid_at ON orders(paid_at DESC) WHERE status = 'paid';

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ORDER ITEMS
CREATE TABLE order_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id),
  name_snapshot   TEXT NOT NULL,
  unit_price      DECIMAL(12,2) NOT NULL,
  quantity        DECIMAL(10,3) NOT NULL CHECK (quantity > 0),
  line_total      DECIMAL(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ORDER PAYMENTS
CREATE TABLE order_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method          payment_method NOT NULL,
  amount          DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  cash_received   DECIMAL(12,2),
  change_given    DECIMAL(12,2),
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_payments_order ON order_payments(order_id);
CREATE INDEX idx_order_payments_method ON order_payments(method, paid_at DESC);

COMMENT ON TABLE pos_sessions   IS 'Sessions de caisse (shift) — 1 active max par user';
COMMENT ON TABLE orders         IS 'Header de commande POS';
COMMENT ON TABLE order_items    IS 'Lignes produits de la commande (immutable)';
COMMENT ON TABLE order_payments IS 'Lignes de paiement (immutable, support split)';
