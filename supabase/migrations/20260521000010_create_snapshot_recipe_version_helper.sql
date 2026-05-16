-- 20260521000010_create_snapshot_recipe_version_helper.sql
-- Session 17 / Phase 1.A — Factorise recipe_versions INSERT.
--
-- Internal helper called by tr_snapshot_recipe_version (recipes events) AND
-- tr_snapshot_on_product_cost_change (products.cost_price events, Phase 1.B).
-- Reuses _calculate_recipe_cost_walk for full-cascade product_cost_at_version.
-- NOT permission-gated — callers (triggers) own the security context.

CREATE OR REPLACE FUNCTION _snapshot_recipe_version(
  p_product_id  UUID,
  p_change_note TEXT,
  p_profile     UUID
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_next_version INT;
  v_items        JSONB;
  v_cost         NUMERIC(14,2);
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
  v_cost := COALESCE((v_walk->>'cost_per_unit')::NUMERIC(14,2), 0);

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
END $$;

COMMENT ON FUNCTION _snapshot_recipe_version(UUID, TEXT, UUID) IS
  'Session 17 — Phase 1.A. Factorised helper for recipe_versions INSERT. '
  'Used by tr_snapshot_recipe_version + tr_snapshot_on_product_cost_change. '
  'product_cost_at_version via _calculate_recipe_cost_walk (full cascade depth=5). '
  'NOT permission-gated.';
