-- 20260505010002_init_loyalty_transactions.sql
-- Session 3 / migration 2 : table loyalty_transactions (append-only ledger)
-- points is signed : positive = earn, negative = redeem
-- points_balance_after is snapshot post-application (denormalized for audit trail)

CREATE TABLE loyalty_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_id             UUID REFERENCES orders(id) ON DELETE SET NULL,
  transaction_type     loyalty_txn_type NOT NULL,
  points               INTEGER NOT NULL,
  points_balance_after INTEGER NOT NULL,
  order_amount         DECIMAL(14,2),
  description          TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           UUID REFERENCES user_profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_loyalty_txn_customer ON loyalty_transactions(customer_id, created_at DESC);
CREATE INDEX idx_loyalty_txn_order    ON loyalty_transactions(order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_own_view" ON loyalty_transactions FOR SELECT
  USING (is_authenticated());

COMMENT ON TABLE loyalty_transactions IS
  'Immutable ledger of loyalty point movements. INSERT via complete_order_with_payment only.';
COMMENT ON COLUMN loyalty_transactions.points IS
  'Signed: positive for earn, negative for redeem/adjust.';
COMMENT ON COLUMN loyalty_transactions.points_balance_after IS
  'Snapshot of customers.loyalty_points after this transaction applied.';
