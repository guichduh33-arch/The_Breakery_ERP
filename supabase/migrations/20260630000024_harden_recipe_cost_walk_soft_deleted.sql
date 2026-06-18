-- 20260630000024_harden_recipe_cost_walk_soft_deleted.sql
-- Pre-existing landmine: soft-deleting a product does NOT deactivate its recipe
-- rows. The two snapshot cascades (tr_snapshot_recipe_version on recipes,
-- tr_snapshot_on_product_cost_change on products.cost_price) walk transitive
-- ancestors via the still-active recipe rows WITHOUT checking the ancestor
-- product is alive — so they snapshot soft-deleted products, and
-- _calculate_recipe_cost_walk then RAISES 'product_not_found' the moment it
-- recurses into a soft-deleted sub-recipe material (its top SELECT filters
-- deleted_at IS NULL). Any real cost_price change (PO receipt WAC, manual
-- correction, the new recipe-cost recompute) that touches such a product aborts.
--
-- Two-part hardening:
--   1. _calculate_recipe_cost_walk treats a missing / soft-deleted node as a
--      0-cost leaf (flag 'missing') instead of raising — cost computation must
--      degrade gracefully, never crash a money path.
--   2. Both cascade triggers exclude soft-deleted ancestor PRODUCTS, so we stop
--      creating snapshots for dead products entirely.
--
-- Body otherwise identical to 20260629000015 (widened NUMERIC(38,s)).

-- ── 1) Walk: missing node → 0-cost leaf, not RAISE ──────────────────────────
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
    -- HARDENING: a missing / soft-deleted node contributes 0 cost and stops the
    -- branch, instead of aborting the whole walk (and any cost-change cascade).
    RETURN jsonb_build_object(
      'product_id',    p_product_id,
      'cost_per_unit', 0,
      'breakdown',     '[]'::jsonb,
      'depth_reached', p_current_depth,
      'has_cycle',     FALSE,
      'missing',       TRUE
    );
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

-- ── 2a) recipes trigger: only cascade through ALIVE ancestor products ───────
CREATE OR REPLACE FUNCTION public.tr_snapshot_recipe_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id   UUID;
  v_action       TEXT;
  v_profile      UUID;
  v_product_name TEXT;
  v_ancestor     RECORD;
  v_alive        BOOLEAN;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
    v_action     := 'delete';
  ELSE
    v_product_id := NEW.product_id;
    v_action     := lower(TG_OP);
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;

  -- Only snapshot the directly-edited product if it is still alive.
  SELECT (deleted_at IS NULL) INTO v_alive FROM products WHERE id = v_product_id;
  IF COALESCE(v_alive, FALSE) THEN
    PERFORM _snapshot_recipe_version(v_product_id, v_action, v_profile);
  END IF;

  SELECT name INTO v_product_name FROM products WHERE id = v_product_id;

  FOR v_ancestor IN
    WITH RECURSIVE ancestors AS (
      SELECT DISTINCT r.product_id
        FROM recipes r
       WHERE r.material_id = v_product_id
         AND r.is_active = TRUE
         AND r.deleted_at IS NULL
      UNION
      SELECT DISTINCT r.product_id
        FROM recipes r
        JOIN ancestors a ON r.material_id = a.product_id
       WHERE r.is_active = TRUE
         AND r.deleted_at IS NULL
    )
    SELECT a.product_id FROM ancestors a
      JOIN products p ON p.id = a.product_id
     WHERE p.deleted_at IS NULL
  LOOP
    PERFORM _snapshot_recipe_version(
      v_ancestor.product_id,
      'cascade: ' || COALESCE(v_product_name, v_product_id::TEXT) || ' changed',
      v_profile
    );
  END LOOP;

  RETURN NULL;
END $$;

-- ── 2b) products.cost_price trigger: same alive-ancestor filter ─────────────
CREATE OR REPLACE FUNCTION public.tr_snapshot_on_product_cost_change()
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
    SELECT a.product_id FROM ancestors a
      JOIN products p ON p.id = a.product_id
     WHERE p.deleted_at IS NULL
  LOOP
    PERFORM _snapshot_recipe_version(v_ancestor.product_id, v_change_note, v_profile);
  END LOOP;

  RETURN NULL;
END $$;
