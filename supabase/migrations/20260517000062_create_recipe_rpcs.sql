-- 20260517000062_create_recipe_rpcs.sql
-- Session 13 / Phase 2.A — Recipe RPCs : upsert / list / deactivate.
--
-- All three are SECURITY DEFINER public RPCs.
--   upsert_recipe_v1     — gated by inventory.recipes.update (MANAGER+).
--   list_recipes_v1      — gated by inventory.read (everyone with read).
--   deactivate_recipe_v1 — gated by inventory.recipes.update (MANAGER+).
--
-- Upsert semantics : if a row exists with (product_id, material_id) is_active=true
-- and deleted_at IS NULL, UPDATE it (quantity, unit, notes). Otherwise INSERT.
-- This preserves the UNIQUE PARTIAL constraint and avoids accidental version
-- proliferation for routine edits. To version a recipe row, call
-- deactivate_recipe_v1 first then upsert_recipe_v1 with the new quantity.

-- ──────────────────────────────────────────────────────────────────────────────
-- upsert_recipe_v1
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION upsert_recipe_v1(
  p_product_id   UUID,
  p_material_id  UUID,
  p_quantity     DECIMAL(10,3),
  p_unit         TEXT,
  p_notes        TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_recipe_id UUID;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.recipes.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_product_id IS NULL OR p_material_id IS NULL THEN
    RAISE EXCEPTION 'product_id_and_material_id_required' USING ERRCODE='P0001';
  END IF;

  IF p_product_id = p_material_id THEN
    RAISE EXCEPTION 'material_must_differ_from_product' USING ERRCODE='P0001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
  END IF;

  IF p_unit IS NULL OR length(trim(p_unit)) = 0 THEN
    RAISE EXCEPTION 'unit_required' USING ERRCODE='P0001';
  END IF;

  -- Verify both products exist.
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_material_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'material_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- UPSERT : if an active, non-deleted row exists, update it ; else insert.
  SELECT id INTO v_recipe_id FROM recipes
    WHERE product_id = p_product_id
      AND material_id = p_material_id
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_recipe_id IS NOT NULL THEN
    UPDATE recipes
      SET quantity = p_quantity,
          unit     = p_unit,
          notes    = p_notes,
          updated_at = now()
      WHERE id = v_recipe_id;
  ELSE
    INSERT INTO recipes (product_id, material_id, quantity, unit, notes, is_active)
      VALUES (p_product_id, p_material_id, p_quantity, p_unit, p_notes, TRUE)
      RETURNING id INTO v_recipe_id;
  END IF;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'recipe.upsert', 'recipes', v_recipe_id,
    jsonb_build_object(
      'product_id',  p_product_id,
      'material_id', p_material_id,
      'quantity',    p_quantity,
      'unit',        p_unit
    ),
    v_profile
  );

  RETURN v_recipe_id;
END $$;

GRANT EXECUTE ON FUNCTION upsert_recipe_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION upsert_recipe_v1 FROM anon;

COMMENT ON FUNCTION upsert_recipe_v1 IS
  'Session 13 — Phase 2.A. SECURITY DEFINER public RPC. Upserts a recipe '
  'row keyed by (product_id, material_id) active+non-deleted. Gated by '
  'inventory.recipes.update (MANAGER+).';

-- ──────────────────────────────────────────────────────────────────────────────
-- list_recipes_v1 — return active recipe rows for a product as JSONB.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION list_recipes_v1(p_product_id UUID)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  RETURN QUERY
    SELECT jsonb_build_object(
      'recipe_id',     r.id,
      'product_id',    r.product_id,
      'product_name',  p.name,
      'product_unit',  p.unit,
      'material_id',   r.material_id,
      'material_name', m.name,
      'material_unit', m.unit,
      'material_cost_price', m.cost_price,
      'quantity',      r.quantity,
      'unit',          r.unit,
      'is_active',     r.is_active,
      'notes',         r.notes,
      'created_at',    r.created_at,
      'updated_at',    r.updated_at
    )
    FROM recipes r
    JOIN products p ON p.id = r.product_id
    JOIN products m ON m.id = r.material_id
    WHERE r.product_id = p_product_id
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
    ORDER BY m.name;
END $$;

GRANT EXECUTE ON FUNCTION list_recipes_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION list_recipes_v1 FROM anon;

COMMENT ON FUNCTION list_recipes_v1 IS
  'Session 13 — Phase 2.A. Lists active recipe rows for a product, with '
  'material join. Gated by inventory.read.';

-- ──────────────────────────────────────────────────────────────────────────────
-- deactivate_recipe_v1 — soft-delete (is_active=false + deleted_at=now()).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION deactivate_recipe_v1(p_recipe_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_found   UUID;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.recipes.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  UPDATE recipes
    SET is_active  = FALSE,
        deleted_at = now(),
        updated_at = now()
    WHERE id = p_recipe_id AND deleted_at IS NULL
    RETURNING id INTO v_found;

  IF v_found IS NULL THEN
    RAISE EXCEPTION 'recipe_not_found' USING ERRCODE='P0002';
  END IF;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES ('recipe.deactivate', 'recipes', v_found, '{}'::jsonb, v_profile);

  RETURN v_found;
END $$;

GRANT EXECUTE ON FUNCTION deactivate_recipe_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION deactivate_recipe_v1 FROM anon;

COMMENT ON FUNCTION deactivate_recipe_v1 IS
  'Session 13 — Phase 2.A. Soft-deletes a recipe row (is_active=false + '
  'deleted_at=now()). Gated by inventory.recipes.update (MANAGER+).';
