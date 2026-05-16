-- 20260521000011_bump_tr_snapshot_recipe_version_cascade.sql
-- Session 17 / Phase 1.A — Refactor recipes trigger : full-cascade cost via
-- helper + ancestor cascade snapshots (DEV-S16-2.B-01) + cleanups
-- (DEV-S16-2.B-03/04/05). The `WHEN OTHERS` block is removed (SELECT INTO
-- in PL/pgSQL leaves the target NULL on no-row, never raises NO_DATA_FOUND).

CREATE OR REPLACE FUNCTION tr_snapshot_recipe_version()
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

  -- 1) Snapshot the directly-edited product (full-cascade cost via helper).
  PERFORM _snapshot_recipe_version(v_product_id, v_action, v_profile);

  -- 2) Walk transitive ancestors and snapshot each.
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
    SELECT product_id FROM ancestors
  LOOP
    PERFORM _snapshot_recipe_version(
      v_ancestor.product_id,
      'cascade: ' || COALESCE(v_product_name, v_product_id::TEXT) || ' changed',
      v_profile
    );
  END LOOP;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION tr_snapshot_recipe_version() IS
  'Session 17 / Phase 1.A (bumped from S16 / Phase 2.B). AFTER INSERT/UPDATE/DELETE '
  'on `recipes`. Snapshots directly-edited product AND every transitive ancestor '
  '(WITH RECURSIVE walk). product_cost_at_version is full-cascade depth-5 via '
  '_calculate_recipe_cost_walk. WHEN OTHERS removed.';
