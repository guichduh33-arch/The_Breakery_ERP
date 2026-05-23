-- Session 27c / Wave 1 — Extend products with variant linkage.
--
-- Approach A "Linked Products" : each variant is a full product row.
-- Zero cascade downstream (order_items/stock_movements/recipes/po_lines
-- already FK on products.id which points directly to the variant).

ALTER TABLE products
  ADD COLUMN parent_product_id  UUID REFERENCES products(id) ON DELETE RESTRICT,
  ADD COLUMN variant_label      TEXT,
  ADD COLUMN variant_axis       variant_axis_type,
  ADD COLUMN variant_sort_order INTEGER NOT NULL DEFAULT 0;

-- XOR consistency : either standalone/parent (3 NULL) OR variant (3 NOT NULL).
ALTER TABLE products
  ADD CONSTRAINT products_variant_xor CHECK (
    (parent_product_id IS NULL AND variant_label IS NULL AND variant_axis IS NULL)
    OR
    (parent_product_id IS NOT NULL AND variant_label IS NOT NULL AND variant_axis IS NOT NULL)
  );

-- Anti-self-reference (CHECK simple ; trigger covers nesting in next migration).
ALTER TABLE products
  ADD CONSTRAINT products_variant_no_self CHECK (
    parent_product_id IS NULL OR parent_product_id != id
  );

-- Partial index for parent lookup (only active variants).
CREATE INDEX idx_products_parent_id ON products(parent_product_id)
  WHERE parent_product_id IS NOT NULL AND deleted_at IS NULL;

-- Unique (parent, label) to prevent duplicate variant labels per parent.
CREATE UNIQUE INDEX uniq_products_parent_label ON products(parent_product_id, variant_label)
  WHERE parent_product_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN products.parent_product_id IS
  'NULL = standalone product or parent. NOT NULL = variant of another product. 1 level of nesting max (enforced by trigger _012).';
COMMENT ON COLUMN products.variant_label IS
  'Human-readable label distinguishing this variant from siblings (ex: "Amande", "Petit", "Tranché"). Combined with parent.name to build the virtual full name.';
COMMENT ON COLUMN products.variant_axis IS
  'Axis this variant belongs to. Same axis across all variants of a parent.';
COMMENT ON COLUMN products.variant_sort_order IS
  'Display order among siblings. Maintained by reorder_variants_v1 RPC (10/20/30 step pattern).';
