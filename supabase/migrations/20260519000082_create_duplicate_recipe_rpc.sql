-- 20260519000082_create_duplicate_recipe_rpc.sql
-- Session 15 / Phase 3.B — Recipe duplication RPC.
--
-- Decision D9 (Spec 2026-05-15) : clone ALL active recipe rows from a
-- source product to a target product. The target product must have NO
-- active recipes currently (clean clone, not merge). Refuses self-clone
-- and graph cycles (target appears in source's descendance).
--
-- Returns jsonb { source_product_id, target_product_id, rows_copied,
--                  idempotent_replay }.
--
-- Idempotency : when `p_idempotency_key` is provided and an existing
-- audit_log row with action='recipe.duplicated' carries the same key
-- in its payload, the RPC short-circuits and returns the original payload
-- with `idempotent_replay=true`. No rows are inserted.
--
-- Permission gate : `inventory.recipes.update` (MANAGER+), mirroring
-- upsert_recipe_v1 / deactivate_recipe_v1.

CREATE OR REPLACE FUNCTION duplicate_recipe_v1(
  p_source_product_id UUID,
  p_target_product_id UUID,
  p_idempotency_key   UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_existing  RECORD;
  v_rows_copied INT;
  v_payload   JSONB;
  v_has_cycle BOOLEAN;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.recipes.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_source_product_id IS NULL OR p_target_product_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  IF p_source_product_id = p_target_product_id THEN
    RAISE EXCEPTION 'source_equals_target' USING ERRCODE='P0001';
  END IF;

  -- Verify both products exist and are active.
  IF NOT EXISTS (
    SELECT 1 FROM products
     WHERE id = p_source_product_id
       AND is_active = TRUE
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product_not_found'
      USING ERRCODE = 'P0002',
            DETAIL  = format('source product %s missing or inactive', p_source_product_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM products
     WHERE id = p_target_product_id
       AND is_active = TRUE
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'product_not_found'
      USING ERRCODE = 'P0002',
            DETAIL  = format('target product %s missing or inactive', p_target_product_id);
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Idempotency : reuse audit_log payload if the same key was processed before.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT payload INTO v_existing
      FROM audit_log
     WHERE action = 'recipe.duplicated'
       AND payload->>'idempotency_key' = p_idempotency_key::text
     ORDER BY occurred_at DESC
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'source_product_id', v_existing.payload->>'source_product_id',
        'target_product_id', v_existing.payload->>'target_product_id',
        'rows_copied',       (v_existing.payload->>'rows_copied')::INT,
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  -- Target must have no active recipe rows currently.
  IF EXISTS (
    SELECT 1 FROM recipes
     WHERE product_id = p_target_product_id
       AND is_active  = TRUE
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target_has_active_recipes'
      USING ERRCODE = 'P0001',
            DETAIL  = format('target product %s already has active recipe rows', p_target_product_id);
  END IF;

  -- Cycle guard : if the target appears anywhere in the descendance of source,
  -- cloning would create a cycle when the new rows are inserted under target.
  WITH RECURSIVE descendants(material_id, depth, path) AS (
    SELECT r.material_id, 1, ARRAY[r.material_id]::UUID[]
      FROM recipes r
     WHERE r.product_id = p_source_product_id
       AND r.is_active  = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT r.material_id, d.depth + 1, d.path || r.material_id
      FROM descendants d
      JOIN recipes r ON r.product_id = d.material_id
     WHERE r.is_active  = TRUE
       AND r.deleted_at IS NULL
       AND d.depth < 6
       AND NOT (r.material_id = ANY(d.path))
  )
  SELECT EXISTS (
    SELECT 1 FROM descendants WHERE material_id = p_target_product_id
  ) INTO v_has_cycle;

  IF v_has_cycle THEN
    RAISE EXCEPTION 'recipe_cycle_detected'
      USING ERRCODE = 'P0001',
            DETAIL  = format('cloning recipe of %s onto %s would form a cycle', p_source_product_id, p_target_product_id);
  END IF;

  -- Clone active rows. preserve material_id, quantity, unit, notes.
  WITH cloned AS (
    INSERT INTO recipes (
      product_id, material_id, quantity, unit, notes, is_active, created_at, updated_at
    )
    SELECT
      p_target_product_id,
      r.material_id,
      r.quantity,
      r.unit,
      r.notes,
      TRUE,
      now(),
      now()
    FROM recipes r
    WHERE r.product_id = p_source_product_id
      AND r.is_active  = TRUE
      AND r.deleted_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) INTO v_rows_copied FROM cloned;

  v_payload := jsonb_build_object(
    'source_product_id', p_source_product_id,
    'target_product_id', p_target_product_id,
    'rows_copied',       v_rows_copied,
    'idempotency_key',   p_idempotency_key
  );

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES ('recipe.duplicated', 'recipes', p_target_product_id, v_payload, v_profile);

  RETURN jsonb_build_object(
    'source_product_id', p_source_product_id,
    'target_product_id', p_target_product_id,
    'rows_copied',       v_rows_copied,
    'idempotent_replay', FALSE
  );
END $$;

REVOKE EXECUTE ON FUNCTION duplicate_recipe_v1(UUID, UUID, UUID) FROM public;
GRANT  EXECUTE ON FUNCTION duplicate_recipe_v1(UUID, UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION duplicate_recipe_v1(UUID, UUID, UUID) FROM anon;

COMMENT ON FUNCTION duplicate_recipe_v1(UUID, UUID, UUID) IS
  'Session 15 — Phase 3.B. Clones all active recipe rows from a source '
  'product to a target product. Target must have no active recipes. '
  'Refuses self-clone and cycles. Gated by inventory.recipes.update. '
  'Idempotent on p_idempotency_key. Audit action: recipe.duplicated.';
