-- 20260704000013_create_delete_combo_v1.sql
-- Session 47 / Wave A — soft-delete a combo (mirrors delete_product_v1 S45).
-- Gate combos.delete (ADMIN+ only; MANAGER excluded — corbeille masquée).

CREATE OR REPLACE FUNCTION delete_combo_v1(p_combo_product_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user      UUID;
  v_profile   UUID;
  v_deleted_at TIMESTAMPTZ;
  v_type      TEXT;
BEGIN
  v_user := auth.uid();
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_user AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_user, 'combos.delete') THEN
    RAISE EXCEPTION 'Permission denied: combos.delete' USING ERRCODE = 'P0003';
  END IF;

  SELECT product_type, deleted_at INTO v_type, v_deleted_at
    FROM products WHERE id = p_combo_product_id;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Combo not found: %', p_combo_product_id USING ERRCODE = 'P0002';
  END IF;
  IF v_type <> 'combo' THEN
    RAISE EXCEPTION 'Not a combo: %', p_combo_product_id USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent replay: already soft-deleted ⇒ no-op.
  IF v_deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('combo_product_id', p_combo_product_id, 'deleted', false);
  END IF;

  UPDATE products
    SET is_active = false, deleted_at = now(), updated_at = now()
    WHERE id = p_combo_product_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile, 'combo.deleted', 'products', p_combo_product_id,
            jsonb_build_object('rpc_version', 'v1'));

  RETURN jsonb_build_object('combo_product_id', p_combo_product_id, 'deleted', true);
END $function$;
