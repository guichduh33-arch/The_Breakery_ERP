-- 20260520000020_bump_recipe_version_snapshot_with_cost.sql
-- Session 16 / Phase 2.B — DEV-S15-2.B-01.
--
-- Embed cost data in the snapshot. Shape changes (D7, breaking) :
--   OLD : jsonb_agg(...)  → bare array
--   NEW : {
--     "items": [{recipe_id, material_id, material_name, quantity, unit, notes, material_cost_price}, ...],
--     "product_cost_at_version": NUMERIC
--   }
--
-- product_cost_at_version is depth-1 only (D8). Sub-recipe material costs
-- resolve to products.cost_price at trigger time, not a recursive cascade.
-- Full cascade snapshot deferred to Session 17+ (DEV-S16-2.B-01).
--
-- Recursion guard pg_trigger_depth() < 1 preserved.

CREATE OR REPLACE FUNCTION tr_snapshot_recipe_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id   UUID;
  v_next_version INT;
  v_items        JSONB;
  v_cost         NUMERIC;
  v_profile      UUID;
  v_action       TEXT;
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
  WHERE r.product_id = v_product_id
    AND r.is_active = TRUE
    AND r.deleted_at IS NULL;

  SELECT COALESCE(SUM(
    (item->>'quantity')::NUMERIC * (item->>'material_cost_price')::NUMERIC
  ), 0)::NUMERIC(14,2)
  INTO v_cost
  FROM jsonb_array_elements(v_items) AS item;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM recipe_versions
   WHERE product_id = v_product_id;

  BEGIN
    SELECT id INTO v_profile FROM user_profiles
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    v_profile := NULL;
  END;

  INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
  VALUES (
    v_product_id,
    v_next_version,
    jsonb_build_object(
      'items',                   v_items,
      'product_cost_at_version', v_cost
    ),
    v_profile,
    v_action
  );

  RETURN NULL;
END $$;

COMMENT ON FUNCTION tr_snapshot_recipe_version() IS
  'Session 16 / Phase 2.B (bumped from Session 15 / Phase 1.A). AFTER INSERT/UPDATE/DELETE '
  'on `recipes`. Snapshots {items: [...], product_cost_at_version: NUMERIC} into '
  'recipe_versions. product_cost_at_version is depth-1 only (D8) ; full cascade '
  'deferred (DEV-S16-2.B-01). Best-effort created_by from auth.uid().';
