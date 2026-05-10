-- 20260510000003_add_order_items_promotion_cols.sql
-- Session 8 / migration 3 : ALTER order_items + orders pour promo persistence.
-- Spec: §3.6, §3.7.

ALTER TABLE order_items
  ADD COLUMN promotion_id        UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN promotion_discount  DECIMAL(14,2) NOT NULL DEFAULT 0
                                 CHECK (promotion_discount >= 0),
  ADD COLUMN is_free_from_promo  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_order_items_promotion
  ON order_items(promotion_id)
  WHERE promotion_id IS NOT NULL;

ALTER TABLE orders
  ADD COLUMN promotion_total_amount DECIMAL(14,2) NOT NULL DEFAULT 0
                                    CHECK (promotion_total_amount >= 0);
