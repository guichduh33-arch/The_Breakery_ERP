-- 20260530185615_create_adjust_display_stock_v1_rpc.sql
-- Correction de comptage vitrine. Gate display.manage. p_reason requis (>= 3 chars).
-- display_movements 'adjustment' (delta signé) + display_stock = p_new_qty. AUCUN effet BO.

CREATE OR REPLACE FUNCTION public.adjust_display_stock_v1(
  p_product_id uuid,
  p_new_qty numeric,
  p_reason text,
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
  v_is_display        BOOLEAN;
  v_existing_movement UUID;
  v_current_qty       NUMERIC(10,3);
  v_delta             NUMERIC(10,3);
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

  IF p_new_qty IS NULL OR p_new_qty < 0 THEN
    RAISE EXCEPTION 'quantity_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR length(TRIM(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT is_display_item INTO v_is_display
    FROM products
   WHERE id = p_product_id;
  IF v_is_display IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_display = FALSE THEN
    RAISE EXCEPTION 'not_a_display_item' USING ERRCODE = 'P0002';
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
        'idempotent_replay',  TRUE,
        'noop',               FALSE
      );
    END IF;
  END IF;

  SELECT quantity INTO v_current_qty
    FROM display_stock
   WHERE product_id = p_product_id
   FOR UPDATE;
  v_current_qty := COALESCE(v_current_qty, 0);
  v_delta := p_new_qty - v_current_qty;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_current_qty,
      'idempotent_replay',  FALSE,
      'noop',               TRUE
    );
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'adjustment', v_delta, p_reason, v_profile_id, p_idempotency_key
    );

    INSERT INTO display_stock (product_id, quantity, updated_at)
    VALUES (p_product_id, p_new_qty, now())
    ON CONFLICT (product_id) DO UPDATE
      SET quantity   = EXCLUDED.quantity,
          updated_at = now()
    RETURNING quantity INTO v_new_qty;

    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_new_qty,
      'idempotent_replay',  FALSE,
      'noop',               FALSE
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT quantity INTO v_new_qty FROM display_stock WHERE product_id = p_product_id;
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  COALESCE(v_new_qty, 0),
      'idempotent_replay',  TRUE,
      'noop',               FALSE
    );
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.adjust_display_stock_v1(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.adjust_display_stock_v1(uuid, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.adjust_display_stock_v1(uuid, numeric, text, uuid) IS
  'Correction comptage vitrine. Gate display.manage. reason requis. display_stock = p_new_qty. Aucun effet BO.';
