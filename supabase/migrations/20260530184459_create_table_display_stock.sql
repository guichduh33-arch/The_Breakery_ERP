-- 20260530184459_create_table_display_stock.sql
-- Cache du compteur vitrine (1 ligne par produit display). Source de vérité = display_movements.
-- Écritures via RPC SECURITY DEFINER uniquement (REVOKE pour authenticated).

CREATE TABLE display_stock (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  quantity   NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE display_stock IS
  'Compteur vitrine POS (cache). Jamais touché par record_stock_movement_v1 ni les '
  'triggers BO. Écrit uniquement par les RPC display_*_v1 (SECURITY DEFINER).';

ALTER TABLE display_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY display_stock_select ON display_stock
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'display.read'));

REVOKE INSERT, UPDATE, DELETE ON display_stock FROM authenticated;
REVOKE ALL ON display_stock FROM anon;
