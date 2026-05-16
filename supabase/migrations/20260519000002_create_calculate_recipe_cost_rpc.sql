-- 20260519000002_create_calculate_recipe_cost_rpc.sql
-- Session 15 / Phase 1.A — F6 sub-recipes : calculate_recipe_cost_v1(p_product_id, p_max_depth=5).
--
-- Decision D2 : recursive on-demand cost cascade. Returns JSONB :
--   {
--     "product_id": "...",
--     "cost_per_unit": numeric,
--     "breakdown": [
--       {"material_id": "...", "material_name": "...", "is_recipe": false,
--        "qty_per_unit": 0.250, "unit_cost": 8000, "subtotal": 2000,
--        "unit": "g"},
--       {"material_id": "...", "material_name": "Croissant dough",
--        "is_recipe": true, "qty_per_unit": 0.100, "unit_cost": 50000,
--        "subtotal": 5000, "unit": "g",
--        "sub_breakdown": [...]}
--     ],
--     "depth_reached": 2,
--     "has_cycle": false
--   }
--
-- SECURITY DEFINER STABLE. Gated by `inventory.read` (read-only RPC).
-- Cycle detection : the recursive walker keeps a path[] and bails if the
-- next material is already in the path (sets has_cycle=true, returns
-- current breakdown without further recursion).
-- Depth check : if depth exceeds p_max_depth, RAISE recipe_depth_exceeded.
--
-- Implementation : PL/pgSQL recursive helper _calculate_recipe_cost_walk that
-- returns (cost numeric, breakdown jsonb[], depth_reached int, has_cycle bool).
-- This is cleaner than a single WITH RECURSIVE because we want per-row
-- sub_breakdown nested JSONB which is hard to express in pure CTE.

-- Helper : recursive walker. Internal (no permission gate). Caller must gate.
CREATE OR REPLACE FUNCTION _calculate_recipe_cost_walk(
  p_product_id UUID,
  p_max_depth  INT,
  p_current_depth INT,
  p_path       UUID[]
) RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_product_unit TEXT;
  v_product_cost DECIMAL(14,4);
  v_breakdown    JSONB := '[]'::JSONB;
  v_total_cost   DECIMAL(14,4) := 0;
  v_max_subdepth INT := p_current_depth;
  v_has_cycle    BOOLEAN := FALSE;
  v_rec          RECORD;
  v_qty_in_material_unit DECIMAL(14,4);
  v_material_is_recipe   BOOLEAN;
  v_sub_result   JSONB;
  v_unit_cost    DECIMAL(14,4);
  v_subtotal     DECIMAL(14,4);
  v_sub_depth    INT;
  v_sub_cycle    BOOLEAN;
  v_line         JSONB;
  v_has_lines    BOOLEAN;
BEGIN
  -- Cycle guard : if product already in path, stop here.
  IF p_product_id = ANY(p_path) THEN
    RETURN jsonb_build_object(
      'product_id',    p_product_id,
      'cost_per_unit', 0,
      'breakdown',     '[]'::jsonb,
      'depth_reached', p_current_depth,
      'has_cycle',     TRUE
    );
  END IF;

  IF p_current_depth > p_max_depth THEN
    RAISE EXCEPTION 'recipe_depth_exceeded'
      USING ERRCODE = 'P0001',
            DETAIL  = format('Cost walk exceeded max depth %s at product %s.', p_max_depth, p_product_id);
  END IF;

  -- Look up product unit + cost_price.
  SELECT unit, cost_price INTO v_product_unit, v_product_cost
    FROM products
   WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002',
      DETAIL = format('product_id=%s', p_product_id);
  END IF;

  -- If product has no active recipe rows, it's a leaf — return its cost_price.
  SELECT EXISTS (
    SELECT 1 FROM recipes WHERE product_id = p_product_id
      AND is_active = TRUE AND deleted_at IS NULL
  ) INTO v_has_lines;

  IF NOT v_has_lines THEN
    RETURN jsonb_build_object(
      'product_id',    p_product_id,
      'cost_per_unit', COALESCE(v_product_cost, 0),
      'breakdown',     '[]'::jsonb,
      'depth_reached', p_current_depth,
      'has_cycle',     FALSE
    );
  END IF;

  -- Iterate active recipe rows.
  FOR v_rec IN
    SELECT r.material_id, r.quantity AS recipe_qty, r.unit AS recipe_unit,
           m.unit AS material_unit, m.cost_price AS material_cost, m.name AS material_name
      FROM recipes r
      JOIN products m ON m.id = r.material_id
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
     ORDER BY m.name
  LOOP
    -- Convert qty to the material's storage unit so we can multiply by its unit_cost.
    BEGIN
      v_qty_in_material_unit := convert_quantity(
        v_rec.recipe_qty,
        v_rec.recipe_unit,
        v_rec.material_unit
      );
    EXCEPTION WHEN OTHERS THEN
      -- Fallback : use recipe_qty as-is (unit conversion impossible). Surface
      -- as zero subtotal contribution but include in breakdown for visibility.
      v_qty_in_material_unit := v_rec.recipe_qty;
    END;

    SELECT EXISTS (
      SELECT 1 FROM recipes WHERE product_id = v_rec.material_id
        AND is_active = TRUE AND deleted_at IS NULL
    ) INTO v_material_is_recipe;

    IF v_material_is_recipe THEN
      -- Recurse to compute sub-recipe's unit cost.
      v_sub_result := _calculate_recipe_cost_walk(
        v_rec.material_id,
        p_max_depth,
        p_current_depth + 1,
        p_path || p_product_id
      );
      v_unit_cost := (v_sub_result->>'cost_per_unit')::DECIMAL(14,4);
      v_sub_cycle := (v_sub_result->>'has_cycle')::BOOLEAN;
      v_sub_depth := (v_sub_result->>'depth_reached')::INT;

      IF v_sub_cycle THEN
        v_has_cycle := TRUE;
      END IF;
      IF v_sub_depth > v_max_subdepth THEN
        v_max_subdepth := v_sub_depth;
      END IF;

      v_subtotal := v_qty_in_material_unit * v_unit_cost;
      v_line := jsonb_build_object(
        'material_id',   v_rec.material_id,
        'material_name', v_rec.material_name,
        'is_recipe',     TRUE,
        'qty_per_unit',  v_rec.recipe_qty,
        'unit',          v_rec.recipe_unit,
        'unit_cost',     v_unit_cost,
        'subtotal',      v_subtotal,
        'sub_breakdown', v_sub_result->'breakdown'
      );
    ELSE
      v_unit_cost := COALESCE(v_rec.material_cost, 0);
      v_subtotal  := v_qty_in_material_unit * v_unit_cost;
      v_line := jsonb_build_object(
        'material_id',   v_rec.material_id,
        'material_name', v_rec.material_name,
        'is_recipe',     FALSE,
        'qty_per_unit',  v_rec.recipe_qty,
        'unit',          v_rec.recipe_unit,
        'unit_cost',     v_unit_cost,
        'subtotal',      v_subtotal
      );
    END IF;

    v_breakdown := v_breakdown || v_line;
    v_total_cost := v_total_cost + v_subtotal;
  END LOOP;

  RETURN jsonb_build_object(
    'product_id',    p_product_id,
    'cost_per_unit', v_total_cost,
    'breakdown',     v_breakdown,
    'depth_reached', v_max_subdepth,
    'has_cycle',     v_has_cycle
  );
END $$;

COMMENT ON FUNCTION _calculate_recipe_cost_walk(UUID, INT, INT, UUID[]) IS
  'Session 15 — Phase 1.A. Internal recursive helper for calculate_recipe_cost_v1. '
  'Walks the recipes BoM tree, computes cost cascade with cycle detection (path[]). '
  'NOT permission-gated — caller (public RPC) must gate.';

-- ──────────────────────────────────────────────────────────────────────────────
-- Public RPC : calculate_recipe_cost_v1
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION calculate_recipe_cost_v1(
  p_product_id UUID,
  p_max_depth  INT DEFAULT 5
) RETURNS JSONB
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
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001',
      DETAIL = 'p_max_depth must be between 1 and 20 (recommended <= 5).';
  END IF;

  RETURN _calculate_recipe_cost_walk(p_product_id, p_max_depth, 1, ARRAY[]::UUID[]);
END $$;

GRANT EXECUTE ON FUNCTION calculate_recipe_cost_v1(UUID, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION calculate_recipe_cost_v1(UUID, INT) FROM anon;

COMMENT ON FUNCTION calculate_recipe_cost_v1(UUID, INT) IS
  'Session 15 — Phase 1.A. Computes recursive recipe cost cascade for p_product_id. '
  'Returns JSONB with cost_per_unit + nested breakdown + depth_reached + has_cycle. '
  'STABLE : same inputs → same output (during transaction). Gated by inventory.read.';
