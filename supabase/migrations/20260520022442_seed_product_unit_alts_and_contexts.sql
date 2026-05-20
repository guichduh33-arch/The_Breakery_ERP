-- Session 27 / Wave 1.A.2 — Idempotent seed: alternatives + per-product contexts.
-- Idempotent via ON CONFLICT DO NOTHING.

-- Alts: add 'g' for kg-based products (currently 0), 'ml' for L-based products (currently 0).
-- Per pre-flight 1.A.0: no kg or L products exist today, so these are effectively no-op
-- but kept for forward compatibility when new kg/L products are added.

INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, tags, display_order)
SELECT p.id, 'g', 0.001, ARRAY['purchase','recipe']::TEXT[], 10
  FROM products p
  WHERE p.unit = 'kg' AND p.deleted_at IS NULL
ON CONFLICT (product_id, code) WHERE deleted_at IS NULL DO NOTHING;

INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, tags, display_order)
SELECT p.id, 'ml', 0.001, ARRAY['recipe']::TEXT[], 10
  FROM products p
  WHERE p.unit = 'L' AND p.deleted_at IS NULL
ON CONFLICT (product_id, code) WHERE deleted_at IS NULL DO NOTHING;

-- Contexts: init every product to base unit for all 4 contexts.
INSERT INTO product_unit_contexts (product_id, stock_opname_unit, recipe_unit, purchase_unit, sales_unit)
SELECT p.id, p.unit, p.unit, p.unit, p.unit
  FROM products p
  WHERE p.deleted_at IS NULL
ON CONFLICT (product_id) DO NOTHING;
