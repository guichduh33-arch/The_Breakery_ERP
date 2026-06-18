-- 20260630000022_create_recipe_direct_cost_v1_rpc.sql
-- The product Costing tab used recipe_bom_full_v1, a RECURSIVE leaves-only BoM
-- cascade. For an assembly built from semi-finished sub-recipes (e.g. American
-- Sandwich → Aioli Sauce → Mayonnaise → …) that:
--   1. explodes the sub-recipes into raw leaf materials, so the ingredient list
--      no longer matches the Recipe tab (which shows the direct lines), and
--   2. multiplies recipe line quantities down the tree WITHOUT normalising by
--      each sub-recipe's yield, inflating quantities/costs to absurd values
--      (Salade Oil 20,157,839 ml, Egg 161,373 pcs, …).
--
-- The Costing tab should mirror the recipe the user entered: the DIRECT lines,
-- each costed at its own material cost_price (a semi-finished's cost_price
-- already rolls up its own ingredients via the WAC / cost-walk snapshot). This
-- RPC returns exactly that — depth-1 — with the same column shape as
-- recipe_bom_full_v1 so the existing CostingPanel table renders unchanged.
--
-- recipe_bom_full_v1 is left untouched; its recursive rollup is still used by
-- the production ingredient-aggregate preview (a separate concern + a separate,
-- broader yield-normalisation bug worth its own fix).

CREATE OR REPLACE FUNCTION public.recipe_direct_cost_v1(
  p_product_id UUID
) RETURNS TABLE(
  material_id    UUID,
  material_name  TEXT,
  material_unit  TEXT,
  recipe_unit    TEXT,
  qty_per_unit   NUMERIC,
  current_stock  NUMERIC,
  cost_price     NUMERIC,
  qty_in_base    NUMERIC,
  line_cost      NUMERIC
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

  RETURN QUERY
  SELECT r.material_id,
         m.name,
         m.unit,
         r.unit,
         r.quantity::NUMERIC,
         m.current_stock,
         m.cost_price,
         public._try_convert_quantity(r.quantity::NUMERIC, r.unit, m.unit) AS qty_in_base,
         public._try_convert_quantity(r.quantity::NUMERIC, r.unit, m.unit) * COALESCE(m.cost_price, 0) AS line_cost
    FROM recipes r
    JOIN products m ON m.id = r.material_id
   WHERE r.product_id = p_product_id
     AND r.is_active = TRUE
     AND r.deleted_at IS NULL
   ORDER BY r.display_order, m.name;
END $$;

GRANT  EXECUTE ON FUNCTION public.recipe_direct_cost_v1(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.recipe_direct_cost_v1(UUID) FROM anon;
REVOKE ALL    ON FUNCTION public.recipe_direct_cost_v1(UUID) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.recipe_direct_cost_v1(UUID) IS
  'inventory.read. Direct (depth-1) recipe-line costing for the product Costing '
  'tab — mirrors the Recipe tab lines. Same column shape as recipe_bom_full_v1 '
  'but NOT recursive: a semi-finished line is costed at its own cost_price '
  '(which already rolls up its sub-ingredients). qty_in_base / line_cost use the '
  'recipe-unit -> stock-unit conversion (_try_convert_quantity, safe fallback).';
