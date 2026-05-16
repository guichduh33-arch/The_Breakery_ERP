-- 20260519000151_bump_upsert_recipe_v1_baker.sql
-- Session 15 / Phase 5.B — extend upsert_recipe_v1 body to accept baker
-- percentage fields without changing the published signature shape.
--
-- New OPTIONAL trailing params :
--   p_is_baker_percentage BOOLEAN DEFAULT FALSE
--   p_baker_percentage    NUMERIC DEFAULT NULL
--
-- Behavior :
--   - When is_baker_percentage=TRUE, baker_percentage must be supplied (the
--     row-level CHECK constraint catches violations).
--   - When is_baker_percentage=FALSE (default), baker_percentage is forced
--     to NULL to keep flat-mode rows clean even if a stale value is sent.
--   - `quantity` is still required and validated (> 0) — in baker mode the
--     UI computes an absolute quantity (e.g. from a target-flour preview)
--     and persists it alongside the percentage so reads work without an
--     extra RPC call.

-- Drop & recreate (Postgres won't let us add trailing DEFAULT params to an
-- existing function in-place ; we must drop the prior signature first).
DROP FUNCTION IF EXISTS upsert_recipe_v1(uuid, uuid, numeric, text, text);

CREATE OR REPLACE FUNCTION upsert_recipe_v1(
  p_product_id          UUID,
  p_material_id         UUID,
  p_quantity            NUMERIC,
  p_unit                TEXT,
  p_notes               TEXT    DEFAULT NULL,
  p_is_baker_percentage BOOLEAN DEFAULT FALSE,
  p_baker_percentage    NUMERIC DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_recipe_id UUID;
  v_baker_pct NUMERIC;
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

  IF p_is_baker_percentage = TRUE AND p_baker_percentage IS NULL THEN
    RAISE EXCEPTION 'baker_percentage_required' USING ERRCODE='P0001';
  END IF;

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

  -- Force baker_percentage to NULL in flat mode to keep the column clean.
  v_baker_pct := CASE WHEN p_is_baker_percentage THEN p_baker_percentage ELSE NULL END;

  SELECT id INTO v_recipe_id FROM recipes
    WHERE product_id = p_product_id
      AND material_id = p_material_id
      AND is_active = TRUE
      AND deleted_at IS NULL
    LIMIT 1;

  IF v_recipe_id IS NOT NULL THEN
    UPDATE recipes
      SET quantity            = p_quantity,
          unit                = p_unit,
          notes               = p_notes,
          is_baker_percentage = p_is_baker_percentage,
          baker_percentage    = v_baker_pct,
          updated_at          = now()
      WHERE id = v_recipe_id;
  ELSE
    INSERT INTO recipes (
      product_id, material_id, quantity, unit, notes,
      is_active, is_baker_percentage, baker_percentage
    )
      VALUES (
        p_product_id, p_material_id, p_quantity, p_unit, p_notes,
        TRUE, p_is_baker_percentage, v_baker_pct
      )
      RETURNING id INTO v_recipe_id;
  END IF;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'recipe.upsert', 'recipes', v_recipe_id,
    jsonb_build_object(
      'product_id',          p_product_id,
      'material_id',         p_material_id,
      'quantity',            p_quantity,
      'unit',                p_unit,
      'is_baker_percentage', p_is_baker_percentage,
      'baker_percentage',    v_baker_pct
    ),
    v_profile
  );

  RETURN v_recipe_id;
END $$;

REVOKE EXECUTE ON FUNCTION upsert_recipe_v1(UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN, NUMERIC) FROM public;
GRANT  EXECUTE ON FUNCTION upsert_recipe_v1(UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN, NUMERIC) TO authenticated;
REVOKE EXECUTE ON FUNCTION upsert_recipe_v1(UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN, NUMERIC) FROM anon;

COMMENT ON FUNCTION upsert_recipe_v1(UUID, UUID, NUMERIC, TEXT, TEXT, BOOLEAN, NUMERIC) IS
  'Session 15 — Phase 5.B (body bump). Insert-or-update an active recipe row by (product_id, material_id). Trailing optional params p_is_baker_percentage + p_baker_percentage carry the baker mode (spec §D13). When flat mode, baker_percentage is forced NULL. Backward-compat : callers passing only the original 5 args still work because the new params default. Gated by inventory.recipes.update.';
