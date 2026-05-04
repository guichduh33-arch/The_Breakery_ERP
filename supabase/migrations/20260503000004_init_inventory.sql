-- 20260503000004_init_inventory.sql
-- Phase 2 / migration 5 : ledger stock

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  movement_type   movement_type NOT NULL,
  quantity        DECIMAL(10,3) NOT NULL,
  reference_type  TEXT NOT NULL,
  reference_id    UUID NOT NULL,
  created_by      UUID NOT NULL REFERENCES user_profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX idx_stock_movements_ref ON stock_movements(reference_type, reference_id);

COMMENT ON TABLE stock_movements IS
  'Ledger append-only des mouvements de stock. Quantity signée: négatif pour sale/waste, positif pour purchase/production.';
