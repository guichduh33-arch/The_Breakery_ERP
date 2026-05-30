-- 20260530185330_create_return_display_to_kitchen_v1_rpc.sql
-- Retour cuisine (clôture). Gate display.manage. display_stock -= q.
-- current_stock INCHANGÉ, AUCUN JE (le produit reste compté en stock cuisine BO).

CREATE OR REPLACE FUNCTION public.return_display_to_kitchen_v1(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile_id        UUID;
  v_existing_movement UUID;
  v_current_qty       NUMERIC(10,3);
  v_new_qty           NUMERIC(10,3);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission(v_uid, 'display.manage') THEN
    RAISE EXCEPTION 'forbidden: display.manage required' USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_movement
      FROM display_movements
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF v_existing_movement IS NOT NULL THEN
      SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
      RETURN jsonb_build_object(
        'product_id',         p_product_id,
        'new_display_stock',  COALESCE(v_new_qty, 0),
        'idempotent_replay',  TRUE
      );
    END IF;
  END IF;

  SELECT quantity INTO v_current_qty
    FROM display_stock
   WHERE product_id = p_product_id
   FOR UPDATE;
  IF v_current_qty IS NULL OR v_current_qty < p_quantity THEN
    RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE = 'P0002';
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'return_to_kitchen', -p_quantity, p_reason, v_profile_id, p_idempotency_key
    );

    UPDATE display_stock
       SET quantity = quantity - p_quantity,
           updated_at = now()
     WHERE product_id = p_product_id
    RETURNING quantity INTO v_new_qty;

    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_new_qty,
      'idempotent_replay',  FALSE
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  COALESCE(v_new_qty, 0),
      'idempotent_replay',  TRUE
    );
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.return_display_to_kitchen_v1(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.return_display_to_kitchen_v1(uuid, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.return_display_to_kitchen_v1(uuid, numeric, text, uuid) IS
  'Retour cuisine (clôture). Gate display.manage. display_stock -= q. current_stock inchangé, aucun JE.';
