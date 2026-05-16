-- 20260520000011_backfill_is_semi_finished.sql
-- Session 16 / Phase 2.A — Backfill is_semi_finished for existing products.
-- Same predicate as the old EXISTS subquery in search_ingredients_v1.

UPDATE products p
   SET is_semi_finished = TRUE
 WHERE EXISTS (
   SELECT 1
     FROM recipes r1
     JOIN recipes r2 ON r2.product_id = r1.material_id
                    AND r2.is_active = TRUE
                    AND r2.deleted_at IS NULL
    WHERE r1.product_id = p.id
      AND r1.is_active = TRUE
      AND r1.deleted_at IS NULL
 );
