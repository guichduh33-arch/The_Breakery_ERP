-- 20260510000002_init_order_promotions.sql
-- Session 8 / migration 2 : table d'audit order_promotions (cart-level OU item-level).
-- Spec: §3.5, §3.12.

CREATE TABLE order_promotions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id         UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  target               TEXT NOT NULL CHECK (target IN ('cart', 'item')),
  target_order_item_id UUID REFERENCES order_items(id) ON DELETE CASCADE,
  discount_amount      DECIMAL(14,2) NOT NULL CHECK (discount_amount >= 0),
  free_item_added      BOOLEAN NOT NULL DEFAULT false,
  metadata             JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (target = 'cart' AND target_order_item_id IS NULL) OR
    (target = 'item' AND target_order_item_id IS NOT NULL)
  )
);

CREATE INDEX idx_order_promotions_order ON order_promotions(order_id);
CREATE INDEX idx_order_promotions_promotion ON order_promotions(promotion_id);

ALTER TABLE order_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON order_promotions FOR SELECT
  USING (is_authenticated());
-- Pas de WRITE policy : insert via RPC SECURITY DEFINER uniquement.
