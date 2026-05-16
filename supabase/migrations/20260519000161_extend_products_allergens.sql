-- Session 15 / Phase 5.C — Add self-declared allergens column to products.
--
-- Stores the allergens directly tagged on the product itself. Use
-- `view_product_allergens_resolved` (migration 162) for the recursive union
-- of own + propagated-via-recipes-cascade allergens.
--
-- No backfill — every product defaults to '{}'. Operators tag finished goods
-- + raw materials manually via the AllergensSelector in the BO product fiche.
--
-- Spec ref: docs/workplan/specs/2026-05-15-session-15-spec.md §D14.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS allergens allergen_type[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.products.allergens IS
  'Self-declared allergens. Use view_product_allergens_resolved for the recursive union (own + propagated via recipes cascade). Session 15 Phase 5.C, D14.';

-- GIN index for overlap (&&), contains (@>), contained-by (<@) queries on
-- the array column. Useful when filtering catalog by allergens later.
CREATE INDEX IF NOT EXISTS idx_products_allergens_gin
  ON public.products
  USING GIN (allergens);
