-- 20260530184552_create_table_display_movements.sql
-- Ledger append-only des mouvements vitrine — source de vérité.
-- Table SÉPARÉE de stock_movements → zéro contact avec le ledger BO ni tr_20_je_emit.

CREATE TABLE display_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id),
  movement_type   display_movement_type NOT NULL,
  quantity        NUMERIC(10,3) NOT NULL CHECK (quantity <> 0),  -- signée
  reason          TEXT,
  reference_type  TEXT,
  reference_id    UUID,
  created_by      UUID NOT NULL REFERENCES user_profiles(id),
  idempotency_key UUID UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_display_movements_product_created
  ON display_movements (product_id, created_at DESC);

COMMENT ON TABLE display_movements IS
  'Ledger append-only vitrine POS. Aucun JE inventaire émis ici. La seule passerelle '
  'vitrine→BO est la vente (complete_order v10) et la perte (waste_display_stock_v1), '
  'gérées explicitement dans leurs RPC. idempotency_key UNIQUE = replay-safe.';

ALTER TABLE display_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY display_movements_select ON display_movements
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'display.read'));

REVOKE INSERT, UPDATE, DELETE ON display_movements FROM authenticated;
REVOKE ALL ON display_movements FROM anon;
