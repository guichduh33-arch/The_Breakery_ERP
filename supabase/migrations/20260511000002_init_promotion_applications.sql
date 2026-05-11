-- 20260511000002_init_promotion_applications.sql
-- Session 9 / migration 2 : promotion_applications audit table
-- Spec §3.2 — capture which promotions were applied to each order, with snapshot
-- description for reporting (preserved even if the promo is later soft-deleted).

CREATE TABLE promotion_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  promotion_id    UUID NOT NULL REFERENCES promotions(id) ON DELETE RESTRICT,
  amount          DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  description     TEXT NOT NULL,                          -- snapshot ex: "Happy Hour 18-20h −10%"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, promotion_id)
);

CREATE INDEX idx_promo_apps_order ON promotion_applications(order_id);
CREATE INDEX idx_promo_apps_promo ON promotion_applications(promotion_id, created_at DESC);

-- RLS (spec §3.5) — read-only for authenticated users.
-- INSERT happens exclusively from RPCs SECURITY DEFINER (complete_order_with_payment v7,
-- pay_existing_order v4) which bypass RLS. No INSERT/UPDATE/DELETE policies are exposed.
ALTER TABLE promotion_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON promotion_applications FOR SELECT
  USING (is_authenticated());

COMMENT ON TABLE promotion_applications IS
  'Session 9 — audit row per (order, promo) pair. Snapshot description preserved for reporting even if promo soft-deleted (FK ON DELETE RESTRICT prevents hard-delete).';
