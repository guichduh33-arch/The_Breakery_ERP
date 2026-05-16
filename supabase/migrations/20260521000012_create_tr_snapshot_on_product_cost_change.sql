-- 20260521000012_create_tr_snapshot_on_product_cost_change.sql
-- Session 17 / Phase 1.B — When products.cost_price changes, snapshot every
-- ancestor recipe that depends on this product. Closes the chronological
-- tracking loop for raw material price changes.
--
-- D11 : skip ancestors without recipe (filtered implicitly by WITH RECURSIVE).
-- D4  : the product whose cost_price changed is NOT itself snapshotted —
--       only its transitive ancestors (their cascade cost is now stale).

CREATE OR REPLACE FUNCTION tr_snapshot_on_product_cost_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_profile     UUID;
  v_change_note TEXT;
  v_ancestor    RECORD;
BEGIN
  IF OLD.cost_price IS NOT DISTINCT FROM NEW.cost_price THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;

  v_change_note := format(
    'material price update: %s %s→%s',
    NEW.name,
    COALESCE(OLD.cost_price::TEXT, 'NULL'),
    COALESCE(NEW.cost_price::TEXT, 'NULL')
  );

  FOR v_ancestor IN
    WITH RECURSIVE ancestors AS (
      SELECT DISTINCT r.product_id
        FROM recipes r
       WHERE r.material_id = NEW.id
         AND r.is_active = TRUE
         AND r.deleted_at IS NULL
      UNION
      SELECT DISTINCT r.product_id
        FROM recipes r
        JOIN ancestors a ON r.material_id = a.product_id
       WHERE r.is_active = TRUE
         AND r.deleted_at IS NULL
    )
    SELECT product_id FROM ancestors
  LOOP
    PERFORM _snapshot_recipe_version(v_ancestor.product_id, v_change_note, v_profile);
  END LOOP;

  RETURN NULL;
END $$;

CREATE TRIGGER tr_snapshot_on_product_cost_change
AFTER UPDATE OF cost_price ON products
FOR EACH ROW
WHEN (OLD.cost_price IS DISTINCT FROM NEW.cost_price)
EXECUTE FUNCTION tr_snapshot_on_product_cost_change();

COMMENT ON FUNCTION tr_snapshot_on_product_cost_change() IS
  'Session 17 / Phase 1.B. On products.cost_price UPDATE, snapshots every '
  'ancestor recipe that consumes this product (WITH RECURSIVE walk on '
  'recipes.material_id). Skips the product itself + ancestors without recipe.';
