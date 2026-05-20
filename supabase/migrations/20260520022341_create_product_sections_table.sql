-- Session 27 / Wave 1.A.2 — product_sections M2M table.
CREATE TABLE product_sections (
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  section_id    UUID NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  is_primary    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, section_id)
);

-- At most 1 primary per product
CREATE UNIQUE INDEX idx_product_sections_primary
  ON product_sections(product_id)
  WHERE is_primary = true;

CREATE INDEX idx_product_sections_section ON product_sections(section_id);

ALTER TABLE product_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON product_sections FOR SELECT
  USING (is_authenticated());

REVOKE ALL ON product_sections FROM anon, authenticated, PUBLIC;
GRANT SELECT ON product_sections TO authenticated;

COMMENT ON TABLE product_sections IS
  'M2M product × sections. A product can be assigned to multiple sections (e.g. Cafe + Pastry). '
  'At most one section is flagged is_primary=true per product (partial unique index).';
