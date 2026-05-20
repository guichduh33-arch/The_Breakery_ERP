-- Session 27 / Wave 1.A.2 — product_unit_alternatives table.
CREATE TABLE product_unit_alternatives (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  factor_to_base  NUMERIC(20,10) NOT NULL CHECK (factor_to_base > 0),
  tags            TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
                  CHECK (tags <@ ARRAY['purchase','recipe','sales']::TEXT[]),
  display_order   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_pua_product_code_active
  ON product_unit_alternatives(product_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_pua_product_active
  ON product_unit_alternatives(product_id, display_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER product_unit_alternatives_set_updated_at
  BEFORE UPDATE ON product_unit_alternatives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE product_unit_alternatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON product_unit_alternatives FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);

REVOKE ALL ON product_unit_alternatives FROM anon, authenticated, PUBLIC;
GRANT SELECT ON product_unit_alternatives TO authenticated;

COMMENT ON TABLE product_unit_alternatives IS
  'Alternative units (g, ml, box, ...) per product. Factor relative to products.unit (base).';
COMMENT ON COLUMN product_unit_alternatives.factor_to_base IS
  '1 unit of `code` equals `factor_to_base` units of products.unit. E.g. if base=kg and code=g, factor=0.001.';
COMMENT ON COLUMN product_unit_alternatives.tags IS
  'Which context this unit is acceptable for. Subset of {purchase, recipe, sales}.';
