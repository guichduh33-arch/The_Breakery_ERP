-- 20260520000012_create_tr_recompute_is_semi_finished.sql
-- Session 16 / Phase 2.A — Maintain products.is_semi_finished on recipe
-- INSERT/UPDATE/DELETE. pg_trigger_depth() < 1 guard prevents recursion
-- (same pattern as tr_snapshot_recipe_version).

CREATE OR REPLACE FUNCTION tr_recompute_is_semi_finished()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id     UUID;
  v_parent_product UUID;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  -- Two products may be affected by a single recipe row change:
  --   (a) the parent (recipes.product_id) — its own recipe might gain/lose a sub-recipe child
  --   (b) the material when it itself has a recipe — every product Y that uses this material
  --       as a sub-recipe needs to be revisited when the material's recipe set changes from
  --       empty to non-empty (and vice versa). Edge case: X gains its FIRST recipe after Y
  --       already references X. We handle this by also recomputing every parent that has X
  --       as a material when X's recipe set changes.

  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
  ELSE
    v_product_id := NEW.product_id;
  END IF;

  -- (a) Recompute parent.
  UPDATE products
     SET is_semi_finished = EXISTS (
       SELECT 1
         FROM recipes r1
         JOIN recipes r2 ON r2.product_id = r1.material_id
                        AND r2.is_active = TRUE
                        AND r2.deleted_at IS NULL
        WHERE r1.product_id = v_product_id
          AND r1.is_active = TRUE
          AND r1.deleted_at IS NULL
     )
   WHERE id = v_product_id;

  -- (b) Recompute every product that uses v_product_id as a material — its
  -- is_semi_finished status depends on whether v_product_id itself has any
  -- active recipe rows. Cheap because the parent set is typically small.
  FOR v_parent_product IN
    SELECT DISTINCT r.product_id
      FROM recipes r
     WHERE r.material_id = v_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
  LOOP
    UPDATE products
       SET is_semi_finished = EXISTS (
         SELECT 1
           FROM recipes r1
           JOIN recipes r2 ON r2.product_id = r1.material_id
                          AND r2.is_active = TRUE
                          AND r2.deleted_at IS NULL
          WHERE r1.product_id = v_parent_product
            AND r1.is_active = TRUE
            AND r1.deleted_at IS NULL
       )
     WHERE id = v_parent_product;
  END LOOP;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION tr_recompute_is_semi_finished() IS
  'Session 16 / Phase 2.A. AFTER INSERT/UPDATE/DELETE trigger on `recipes`. '
  'Recomputes products.is_semi_finished for (a) the parent product whose '
  'recipe row changed, (b) every product that consumes the parent as a '
  'sub-recipe. pg_trigger_depth() < 1 guard ; idempotent ; no-op on '
  'recursive re-entry.';

DROP TRIGGER IF EXISTS tr_recipes_recompute_is_semi_finished ON recipes;

CREATE TRIGGER tr_recipes_recompute_is_semi_finished
  AFTER INSERT OR UPDATE OR DELETE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION tr_recompute_is_semi_finished();
