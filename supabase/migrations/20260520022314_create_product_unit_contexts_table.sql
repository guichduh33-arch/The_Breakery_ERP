-- Session 27 / Wave 1.A.2 — product_unit_contexts table.
CREATE TABLE product_unit_contexts (
  product_id          UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  stock_opname_unit   TEXT NOT NULL,
  recipe_unit         TEXT NOT NULL,
  purchase_unit       TEXT NOT NULL,
  sales_unit          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER product_unit_contexts_set_updated_at
  BEFORE UPDATE ON product_unit_contexts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE product_unit_contexts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON product_unit_contexts FOR SELECT
  USING (is_authenticated());

REVOKE ALL ON product_unit_contexts FROM anon, authenticated, PUBLIC;
GRANT SELECT ON product_unit_contexts TO authenticated;

COMMENT ON TABLE product_unit_contexts IS
  'Per-product context overrides : which unit to use for stock opname / recipes / purchases / sales. '
  'Each value must match products.unit (base) OR a product_unit_alternatives.code for the same product. '
  'Validation enforced by set_product_units_v1 RPC, not by SQL FK (would need composite FK).';
