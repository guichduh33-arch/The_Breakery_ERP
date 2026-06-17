-- 20260630000019_bump_recipe_bom_full_v1_unit_converted_line_cost.sql
-- The Costing tab (CostingPanel), the Recipe tab (useRecipeDetail) and the
-- production ingredient preview all multiplied qty_per_unit × cost_price, but
-- qty_per_unit is in the recipe line unit (e.g. gr) while cost_price is per the
-- material's stock unit (e.g. kg) → line cost 1000× too high / wrong-unit needs.
--
-- This bump returns two extra columns computed server-side, mirroring the unit
-- conversion that _calculate_recipe_cost_walk already does:
--   qty_in_base : the recipe quantity converted into the material's stock unit
--   line_cost   : qty_in_base × cost_price  (the dimensionally-correct line cost)
-- Existing columns are unchanged; existing consumers ignore the additions.
--
-- Conversion uses a safe wrapper (_try_convert_quantity) that falls back to the
-- raw quantity when no conversion exists (e.g. gr→cup), so the RPC never errors
-- on a recipe that mixes non-convertible units — exactly the fallback behaviour
-- of _calculate_recipe_cost_walk's per-line EXCEPTION handler.

-- ── Safe conversion helper ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._try_convert_quantity(
  p_qty NUMERIC, p_from TEXT, p_to TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_qty IS NULL THEN RETURN NULL; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN RETURN p_qty; END IF;
  RETURN public.convert_quantity(p_qty, p_from, p_to);
EXCEPTION WHEN OTHERS THEN
  -- No conversion registered (e.g. mass/volume → 'cup'): fall back to raw qty.
  RETURN p_qty;
END $$;

REVOKE EXECUTE ON FUNCTION public._try_convert_quantity(NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._try_convert_quantity(NUMERIC, TEXT, TEXT) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── Bump recipe_bom_full_v1 (RETURNS TABLE change → DROP + CREATE) ───────────
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
  IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 20 THEN
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
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
  SELECT l.material_id,
         p.name,
         p.unit,
         l.recipe_unit,
         l.qty_agg,
         p.current_stock,
         p.cost_price,
         public._try_convert_quantity(l.qty_agg, l.recipe_unit, p.unit) AS qty_in_base,
         public._try_convert_quantity(l.qty_agg, l.recipe_unit, p.unit) * COALESCE(p.cost_price, 0) AS line_cost
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $$;

GRANT EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) FROM anon;
REVOKE ALL ON FUNCTION recipe_bom_full_v1(UUID, INT) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION recipe_bom_full_v1(UUID, INT) IS
  'Session 17 / Phase 1.D (S45 bump + 2026-06-17 unit-cost fix). Server-side '
  'leaves-only BoM cascade depth=p_max_depth (default 5). Cycle guard via path[]. '
  'Aggregates by material_id. Exposes material_unit (products.unit), recipe_unit '
  '(recipes.unit per line), qty_in_base (recipe qty converted into the material '
  'stock unit) and line_cost (qty_in_base × cost_price). Conversion is safe '
  '(_try_convert_quantity falls back to raw qty for unconvertible unit pairs). '
  'Gated by inventory.read.';
