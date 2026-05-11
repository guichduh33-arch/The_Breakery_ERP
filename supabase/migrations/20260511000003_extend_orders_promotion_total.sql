-- 20260511000003_extend_orders_promotion_total.sql
-- Session 9 / migration 3 : capture promotion totals on orders + flag gift items
-- Spec §3.3 + §3.4

-- Capture sum of promotion amounts for reporting (NET method P15) — detail in promotion_applications.
ALTER TABLE orders
  ADD COLUMN promotion_total DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (promotion_total >= 0);

COMMENT ON COLUMN orders.promotion_total IS
  'Session 9 — sum of all auto-promotion amounts applied to this order. Detail in promotion_applications.';

-- Mark gift items (free_product type promos) so they render with PROMO badge in POS.
ALTER TABLE order_items
  ADD COLUMN is_promo_gift  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN promotion_id   UUID REFERENCES promotions(id) ON DELETE SET NULL;

COMMENT ON COLUMN order_items.is_promo_gift IS
  'Session 9 — true when this line was auto-added as a free_product gift. unit_price=0.';
COMMENT ON COLUMN order_items.promotion_id IS
  'Session 9 — FK to the promotion that triggered this item (gifts only ; NULL for paid items).';

-- Sparse index for "find orders that received a gift from promo X" queries.
CREATE INDEX idx_order_items_promo_gift
  ON order_items(promotion_id)
  WHERE is_promo_gift = true;
