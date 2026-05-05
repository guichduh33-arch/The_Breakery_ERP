-- 20260505010003_extend_orders_loyalty.sql
-- Session 3 / migration 3 : extend orders with customer + loyalty snapshot columns

ALTER TABLE orders
  ADD COLUMN customer_id               UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN loyalty_points_earned     INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_points_earned >= 0),
  ADD COLUMN loyalty_points_redeemed   INTEGER NOT NULL DEFAULT 0
    CHECK (loyalty_points_redeemed >= 0),
  ADD COLUMN loyalty_redemption_amount DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (loyalty_redemption_amount >= 0);

CREATE INDEX idx_orders_customer ON orders(customer_id)
  WHERE customer_id IS NOT NULL;
