-- 20260517000066_init_view_product_recipes.sql
-- Session 13 / Phase 2.A — view_product_recipes.
--
-- Read-only view joining recipes with both the produced product and the
-- consumed material. Created WITH (security_invoker=true) so the caller's
-- RLS applies to underlying products/recipes — non-authenticated callers
-- (anon) see nothing because recipes.SELECT requires inventory.read.
--
-- Consumed by module 05 (Products fiche RecipeTab) and module 15 (BO
-- RecipeEditor) without going through list_recipes_v1.

CREATE OR REPLACE VIEW view_product_recipes
WITH (security_invoker=true) AS
SELECT
  r.id                AS recipe_id,
  r.product_id,
  p.name              AS product_name,
  p.sku               AS product_sku,
  p.unit              AS product_unit,
  r.material_id,
  m.name              AS material_name,
  m.sku               AS material_sku,
  m.unit              AS material_unit,
  m.cost_price        AS material_cost_price,
  m.current_stock     AS material_current_stock,
  r.quantity,
  r.unit,
  r.is_active,
  r.notes,
  r.created_at,
  r.updated_at
FROM recipes r
JOIN products p ON p.id = r.product_id AND p.deleted_at IS NULL
JOIN products m ON m.id = r.material_id AND m.deleted_at IS NULL
WHERE r.deleted_at IS NULL;

COMMENT ON VIEW view_product_recipes IS
  'Session 13 — Phase 2.A. Read-only join of recipes + product + material. '
  'security_invoker=true → caller RLS applies (recipes requires inventory.read).';

GRANT SELECT ON view_product_recipes TO authenticated;
REVOKE ALL ON view_product_recipes FROM anon;
