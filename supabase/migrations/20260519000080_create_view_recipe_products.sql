-- 20260519000080_create_view_recipe_products.sql
-- Session 15 / Phase 3.A — IngredientPicker support : view_recipe_products.
--
-- Decision D8 (Spec 2026-05-15) : detect "product is a recipe" via
--   EXISTS (SELECT 1 FROM recipes WHERE product_id = p.id
--           AND is_active = TRUE AND deleted_at IS NULL)
-- This view exposes that flag PLUS a recursive `leaf_ingredient_count`
-- (count of distinct ultimate leaf materials reachable through up to 5
--  levels of sub-recipes — mirrors `_calculate_recipe_cost_walk` depth cap).
--
-- Shape : product_id, sku, name, unit, cost_price, current_stock,
--         has_recipe BOOLEAN, leaf_ingredient_count INT.
--
-- Filter : is_active = TRUE AND deleted_at IS NULL on products.
-- INVOKER rights → underlying RLS on `products` and `recipes` governs visibility.
-- Grant SELECT to `authenticated`.

CREATE OR REPLACE VIEW view_recipe_products
WITH (security_invoker = true) AS
WITH RECURSIVE leaf_walk AS (
  -- Seed : for every active recipe row, start at depth 1 with material_id.
  SELECT
    r.product_id AS root_product_id,
    r.material_id,
    1 AS depth,
    ARRAY[r.product_id]::UUID[] AS path
  FROM recipes r
  WHERE r.is_active = TRUE AND r.deleted_at IS NULL

  UNION ALL

  -- Recurse : if the current material is itself a recipe, descend.
  SELECT
    lw.root_product_id,
    r.material_id,
    lw.depth + 1,
    lw.path || r.product_id
  FROM leaf_walk lw
  JOIN recipes r
    ON r.product_id = lw.material_id
   AND r.is_active = TRUE
   AND r.deleted_at IS NULL
  WHERE lw.depth < 5
    AND NOT (r.product_id = ANY(lw.path))  -- cycle guard
),
leaf_only AS (
  -- A row in leaf_walk is a leaf if its material_id has no further recipe rows.
  SELECT DISTINCT lw.root_product_id, lw.material_id
  FROM leaf_walk lw
  WHERE NOT EXISTS (
    SELECT 1 FROM recipes r2
     WHERE r2.product_id = lw.material_id
       AND r2.is_active = TRUE
       AND r2.deleted_at IS NULL
  )
),
leaf_counts AS (
  SELECT root_product_id AS product_id, COUNT(*)::INT AS leaf_count
  FROM leaf_only
  GROUP BY root_product_id
)
SELECT
  p.id            AS product_id,
  p.sku,
  p.name,
  p.unit,
  p.cost_price,
  p.current_stock,
  EXISTS (
    SELECT 1 FROM recipes r
     WHERE r.product_id = p.id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
  ) AS has_recipe,
  COALESCE(lc.leaf_count, 0) AS leaf_ingredient_count
FROM products p
LEFT JOIN leaf_counts lc ON lc.product_id = p.id
WHERE p.is_active = TRUE
  AND p.deleted_at IS NULL;

GRANT SELECT ON view_recipe_products TO authenticated;
REVOKE SELECT ON view_recipe_products FROM anon;

COMMENT ON VIEW view_recipe_products IS
  'Session 15 — Phase 3.A. Products with has_recipe flag and recursive '
  'leaf_ingredient_count (depth-5 capped, cycle-guarded). INVOKER rights — '
  'underlying RLS on products/recipes governs visibility.';
