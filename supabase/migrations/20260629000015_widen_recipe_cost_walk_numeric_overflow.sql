-- 20260629000015_widen_recipe_cost_walk_numeric_overflow.sql
-- Corrective (DEV-S45-IMP-01 follow-up): widen the recipe cost-cascade working
-- variables so large computed costs no longer raise a raw 22003.
--
-- ROOT CAUSE: _calculate_recipe_cost_walk used DECIMAL(14,4) (max ~10^10) for its
-- per-line working vars (v_subtotal, v_unit_cost, v_qty_in_material_unit,
-- v_total_cost, v_product_cost). A recipe line whose quantity * unit_cost reaches
-- ~10^10 (e.g. a quantity entered in grams instead of kg) overflowed at the
-- variable assignment (line "v_subtotal := v_qty_in_material_unit * v_unit_cost").
-- _snapshot_recipe_version then re-cast cost_per_unit to NUMERIC(14,2) (max ~10^12),
-- a second tight ceiling. The snapshot trigger fires on every recipe write, so the
-- import (W7 INSERT INTO recipes), the BO recipe editor, and production all crash
-- with an opaque "numeric field overflow" (no table CONTEXT — it's a var assignment).
-- Reproduced on cloud: COMBO-001 <- 1,000,000 pcs of BAG-003 (cost 32000) = 3.2e10.
--
-- FIX: widen the working vars to NUMERIC(38,s) — SAME scale (4 / 2) so rounding
-- behaviour and stored snapshot values are unchanged, but the integer ceiling
-- (~10^34) can never realistically overflow. Pure CREATE OR REPLACE, signatures
-- and ACL unchanged -> no types regen, no grant changes.
--
-- NOTE (out of scope): a recipe whose computed cost is genuinely this large is
-- almost always a quantity/unit data error. This migration stops the crash and
-- lets the value flow through honestly; surfacing implausible computed costs at
-- import dry-run time is deferred.

CREATE OR REPLACE FUNCTION public._calculate_recipe_cost_walk(p_product_id uuid, p_max_depth integer, p_current_depth integer, p_path uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_unit TEXT;
  v_product_cost NUMERIC(38,4);
  v_breakdown    JSONB := '[]'::JSONB;
  v_total_cost   NUMERIC(38,4) := 0;
  v_max_subdepth INT := p_current_depth;
  v_has_cycle    BOOLEAN := FALSE;
  v_rec          RECORD;
  v_qty_in_material_unit NUMERIC(38,4);
  v_material_is_recipe   BOOLEAN;
  v_sub_result   JSONB;
  v_unit_cost    NUMERIC(38,4);
  v_subtotal     NUMERIC(38,4);
  v_sub_depth    INT;
  v_sub_cycle    BOOLEAN;
  v_line         JSONB;
  v_has_lines    BOOLEAN;
BEGIN
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

  SELECT unit, cost_price INTO v_product_unit, v_product_cost
    FROM products
   WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002',
      DETAIL = format('product_id=%s', p_product_id);
  END IF;

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
    BEGIN
      v_qty_in_material_unit := convert_quantity(
        v_rec.recipe_qty,
        v_rec.recipe_unit,
        v_rec.material_unit
      );
    EXCEPTION WHEN OTHERS THEN
      v_qty_in_material_unit := v_rec.recipe_qty;
    END;

    SELECT EXISTS (
      SELECT 1 FROM recipes WHERE product_id = v_rec.material_id
        AND is_active = TRUE AND deleted_at IS NULL
    ) INTO v_material_is_recipe;

    IF v_material_is_recipe THEN
      v_sub_result := _calculate_recipe_cost_walk(
        v_rec.material_id,
        p_max_depth,
        p_current_depth + 1,
        p_path || p_product_id
      );
      v_unit_cost := (v_sub_result->>'cost_per_unit')::NUMERIC(38,4);
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
END $function$;

CREATE OR REPLACE FUNCTION public._snapshot_recipe_version(p_product_id uuid, p_change_note text, p_profile uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next_version INT;
  v_items        JSONB;
  v_cost         NUMERIC(38,2);
  v_walk         JSONB;
  v_version_id   UUID;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'recipe_id',           r.id,
        'material_id',         r.material_id,
        'material_name',       m.name,
        'quantity',            r.quantity,
        'unit',                r.unit,
        'notes',               r.notes,
        'material_cost_price', m.cost_price
      ) ORDER BY m.name
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM recipes r
  JOIN products m ON m.id = r.material_id
  WHERE r.product_id = p_product_id
    AND r.is_active  = TRUE
    AND r.deleted_at IS NULL;

  v_walk := _calculate_recipe_cost_walk(p_product_id, 5, 1, ARRAY[]::UUID[]);
  v_cost := COALESCE((v_walk->>'cost_per_unit')::NUMERIC(38,2), 0);

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM recipe_versions
   WHERE product_id = p_product_id;

  INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
  VALUES (
    p_product_id, v_next_version,
    jsonb_build_object('items', v_items, 'product_cost_at_version', v_cost),
    p_profile, p_change_note
  )
  RETURNING id INTO v_version_id;

  RETURN v_version_id;
END $function$;
