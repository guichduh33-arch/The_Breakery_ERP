-- 20260519000001_create_validate_recipe_no_cycle.sql
-- Session 15 / Phase 1.A — F6 sub-recipes : trigger anti-cycle on `recipes`.
--
-- Decision D1 : the graph is recipes(product_id → material_id). When we INSERT
-- or UPDATE a row (product_id=P, material_id=M), we must reject any path that
-- starts at M and reaches P via further `recipes` rows (which would create a
-- cycle P→M→...→P). We also reject depth > 5 hard (max_depth safety).
--
-- The walk only follows ACTIVE non-deleted recipe rows (is_active=TRUE,
-- deleted_at IS NULL). Inactive / soft-deleted rows are ignored — they're not
-- consumed by `record_production_v1` so they cannot induce a runtime cycle.
--
-- Short-circuit : if NEW.material_id is a leaf (no recipes rows where
-- product_id = NEW.material_id), the trigger is a single SELECT and returns
-- immediately.
--
-- ERRCODE P0001 (invalid input) per CLAUDE.md convention.

CREATE OR REPLACE FUNCTION validate_recipe_no_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_max_depth CONSTANT INT := 5;
  v_has_children BOOLEAN;
  v_cycle_hit BOOLEAN;
  v_max_reached INT;
BEGIN
  -- Skip soft-deletes / deactivations — they cannot create cycles.
  IF NEW.is_active IS NOT TRUE OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Short-circuit : if material is a leaf, no walk needed.
  SELECT EXISTS (
    SELECT 1 FROM recipes
    WHERE product_id = NEW.material_id
      AND is_active = TRUE
      AND deleted_at IS NULL
  ) INTO v_has_children;

  IF NOT v_has_children THEN
    RETURN NEW;
  END IF;

  -- Walk the descendant graph starting from material_id. If we encounter
  -- NEW.product_id at any depth, we have a cycle. Track depth; if a path
  -- exceeds v_max_depth we abort with recipe_depth_exceeded.
  WITH RECURSIVE descendants(material_id, depth, path) AS (
    -- Seed : direct materials of NEW.material_id
    SELECT r.material_id,
           1 AS depth,
           ARRAY[r.material_id] AS path
      FROM recipes r
     WHERE r.product_id = NEW.material_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT r.material_id,
           d.depth + 1,
           d.path || r.material_id
      FROM descendants d
      JOIN recipes r ON r.product_id = d.material_id
     WHERE r.is_active = TRUE
       AND r.deleted_at IS NULL
       AND d.depth < (v_max_depth + 1)   -- one extra step to detect overflow
       AND NOT (r.material_id = ANY(d.path))  -- avoid infinite loop on existing cycles
  )
  SELECT EXISTS (SELECT 1 FROM descendants WHERE material_id = NEW.product_id),
         COALESCE(MAX(depth), 0)
    INTO v_cycle_hit, v_max_reached
    FROM descendants;

  IF v_cycle_hit THEN
    RAISE EXCEPTION 'recipe_cycle_detected'
      USING ERRCODE = 'P0001',
            DETAIL  = format('Inserting recipe (%s -> %s) would create a cycle.', NEW.product_id, NEW.material_id);
  END IF;

  IF v_max_reached > v_max_depth THEN
    RAISE EXCEPTION 'recipe_depth_exceeded'
      USING ERRCODE = 'P0001',
            DETAIL  = format('Recipe depth from material %s exceeds max %s (reached %s).', NEW.material_id, v_max_depth, v_max_reached);
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION validate_recipe_no_cycle() IS
  'Session 15 — Phase 1.A. BEFORE INSERT/UPDATE trigger on `recipes`. '
  'Rejects insertion of a row that would form a cycle in the product→material '
  'dependency graph, OR whose descendant depth exceeds 5. ERRCODEs : P0001 '
  '(recipe_cycle_detected, recipe_depth_exceeded). Short-circuits when '
  'material_id is a leaf product. Walks only active+non-deleted recipe rows.';

DROP TRIGGER IF EXISTS tr_validate_recipe_no_cycle ON recipes;

CREATE TRIGGER tr_validate_recipe_no_cycle
  BEFORE INSERT OR UPDATE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION validate_recipe_no_cycle();
