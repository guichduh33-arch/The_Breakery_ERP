-- 20260520000010_extend_products_is_semi_finished.sql
-- Session 16 / Phase 2.A — DEV-S15-3.A-01. Add explicit is_semi_finished
-- flag on products instead of inferring via recipe-of-recipe EXISTS in
-- search_ingredients_v1. Maintained by tr_recipes_recompute_is_semi_finished
-- (migration 012).

ALTER TABLE products
  ADD COLUMN is_semi_finished BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN products.is_semi_finished IS
  'Session 16 / Phase 2.A. TRUE iff this product has an active recipe AND '
  'at least one of its materials is itself a recipe (i.e. nesting depth >= 2). '
  'Maintained by tr_recipes_recompute_is_semi_finished trigger on `recipes`.';
