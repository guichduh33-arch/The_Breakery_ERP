-- 20260629000016_add_recipe_unit_to_recipe_bom_full_v1.sql
-- Expose the recipe line's own unit (recipes.unit, e.g. 'gr') alongside the
-- material's stock unit (products.unit, e.g. 'kg').
--
-- The Costing tab (CostingPanel) was displaying material_unit ('kg') while the
-- Recipe tab shows the per-line unit ('gr'), so the two tabs disagreed. This adds
-- a recipe_unit column threaded through the recursive walk (the recipe line that
-- introduced each leaf carries its unit) so the front end can show the same unit
-- as the Recipe tab.
--
-- Adding an OUT column to a RETURNS TABLE function requires DROP + CREATE (the
-- return type cannot be altered by CREATE OR REPLACE). Grants re-applied after.
-- The added column is additive: existing consumers (IngredientAggregatePreview,
-- useRecipeDetail) ignore it. Types regen committed.
--
-- Note: a leaf reached through several recipe lines is aggregated by material_id;
-- recipe_unit then reports one representative line unit (MIN). For the common
-- single-line case it is exact.

DROP FUNCTION IF EXISTS public.recipe_bom_full_v1(uuid, int);

CREATE FUNCTION public.recipe_bom_full_v1(
  p_product_id UUID,
  p_max_depth  INT DEFAULT 5
) RETURNS TABLE(
  material_id    UUID,
  material_name  TEXT,
  material_unit  TEXT,
  recipe_unit    TEXT,
  qty_per_unit   NUMERIC,
  current_stock  NUMERIC,
  cost_price     NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 20 THEN
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    -- Anchor: cast quantity to plain NUMERIC so the recursive arm's
    -- multiplication (NUMERIC * NUMERIC(10,3)) matches the column type.
    -- line_unit = the recipe line's own unit (recipes.unit).
    SELECT r.product_id    AS root_id,
           r.material_id,
           r.quantity::NUMERIC      AS qty,
           r.unit          AS line_unit,
           1               AS depth,
           ARRAY[r.product_id, r.material_id]::UUID[] AS path
      FROM recipes r
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT w.root_id,
           r.material_id,
           (w.qty * r.quantity::NUMERIC),
           r.unit,
           w.depth + 1,
           w.path || r.material_id
      FROM walk w
      JOIN recipes r
        ON r.product_id = w.material_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
     WHERE w.depth < p_max_depth
       AND NOT (r.material_id = ANY(w.path))
  ),
  leaves AS (
    SELECT w.material_id,
           SUM(w.qty)        AS qty_agg,
           MIN(w.line_unit)  AS recipe_unit
      FROM walk w
     WHERE NOT EXISTS (
       SELECT 1 FROM recipes c
        WHERE c.product_id = w.material_id
          AND c.is_active = TRUE
          AND c.deleted_at IS NULL
     )
     GROUP BY w.material_id
  )
  SELECT l.material_id, p.name, p.unit, l.recipe_unit, l.qty_agg, p.current_stock, p.cost_price
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $$;

GRANT EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) FROM anon;
REVOKE ALL ON FUNCTION recipe_bom_full_v1(UUID, INT) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION recipe_bom_full_v1(UUID, INT) IS
  'Session 17 / Phase 1.D (S45 bump). Server-side leaves-only BoM. WITH RECURSIVE '
  'cascade depth=p_max_depth (default 5). Cycle guard via path[]. Aggregates by '
  'material_id (sum qty). Exposes material_unit (products.unit) AND recipe_unit '
  '(recipes.unit per line, representative MIN when a leaf spans multiple lines). '
  'Gated by inventory.read.';
