-- 20260519000140_extend_products_target_margin.sql
-- Session 15 / Phase 5.A — Add target_gross_margin_pct to products.
--
-- Adds a per-product gross-margin target used by the margin-watch cron
-- (`recompute_recipe_margins_v1`).
--
-- Semantics :
--   - NULL = "no target set" — the product is SKIPPED by the margin watch.
--   - 0..100 (decimal percent). E.g. 60.00 means "60% gross margin target".
--   - We deliberately do NOT default to 60 so legacy products / ingredients
--     stay out of the watch list. Only recipe-built finished products are
--     backfilled to 60% as a sensible starting point — bakery owners can tune
--     later from the product detail page.
--
-- Migration block reserved 20260519000140..149 (spec §D16, Wave 5).

ALTER TABLE products
  ADD COLUMN target_gross_margin_pct DECIMAL(5,2) NULL
    CHECK (target_gross_margin_pct IS NULL
       OR (target_gross_margin_pct >= 0 AND target_gross_margin_pct <= 100));

COMMENT ON COLUMN products.target_gross_margin_pct IS
  'Session 15 / Phase 5.A. Optional gross-margin target (0..100 percent). '
  'NULL = product excluded from the margin watch. Backfilled to 60.00 for '
  'recipe-built finished products by migration 20260519000140 ; legacy and '
  'ingredient products stay NULL on purpose.';

-- Backfill : seed 60.00 for FINISHED products that have at least one active
-- recipe line. Other rows stay NULL.
UPDATE products p
   SET target_gross_margin_pct = 60.00
 WHERE p.deleted_at IS NULL
   AND p.product_type = 'finished'
   AND EXISTS (
     SELECT 1 FROM recipes r
      WHERE r.product_id    = p.id
        AND r.is_active     = TRUE
        AND r.deleted_at IS NULL
   )
   AND p.target_gross_margin_pct IS NULL;
