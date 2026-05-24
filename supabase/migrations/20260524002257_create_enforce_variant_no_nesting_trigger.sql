-- Session 27c / Wave 1 — 1-level hierarchy enforcement via trigger.
--
-- CHECK constraint alone cannot reference other rows. Trigger ensures :
-- 1. A variant's parent is itself NOT a variant (no nesting).
-- 2. A product becoming a variant has no existing children (cannot demote a parent to a variant).

CREATE OR REPLACE FUNCTION enforce_variant_no_nesting() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_product_id IS NOT NULL THEN
    -- (1) Parent must not itself be a variant.
    IF EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = NEW.parent_product_id
        AND p.parent_product_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Cannot nest variants: parent % is itself a variant', NEW.parent_product_id
        USING ERRCODE = 'P0004';
    END IF;

    -- (2) The product becoming a variant must not have existing children.
    IF EXISTS (
      SELECT 1 FROM products p
      WHERE p.parent_product_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Cannot make % a variant: it is already a parent', NEW.id
        USING ERRCODE = 'P0004';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_products_variant_no_nesting
  BEFORE INSERT OR UPDATE OF parent_product_id ON products
  FOR EACH ROW EXECUTE FUNCTION enforce_variant_no_nesting();

COMMENT ON FUNCTION enforce_variant_no_nesting() IS
  'Enforces 1-level hierarchy on products: variants cannot have variants, parents cannot become variants.';
