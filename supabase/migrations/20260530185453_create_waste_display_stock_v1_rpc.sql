-- 20260530185453_create_waste_display_stock_v1_rpc.sql
-- Perte réelle (saisie caisse). Gate display.manage.
-- Vitrine : display_movements 'waste' (-q) + display_stock -= q (garde display_stock >= q).
-- BO      : INSERT direct stock_movements 'waste' (-q) → tr_20_je_emit émet JE waste
--           (DR WASTE_EXPENSE / CR INVENTORY_GENERAL si cost_price*q > 0) + current_stock -= q.
-- La déduction BO N'EST PAS bloquée par une garde current_stock (peut passer négatif).

CREATE OR REPLACE FUNCTION public.waste_display_stock_v1(
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
  v_is_display        BOOLEAN;
  v_unit              TEXT;
  v_existing_movement UUID;
  v_current_qty       NUMERIC(10,3);
  v_new_display_qty   NUMERIC(10,3);
  v_new_bo_stock      NUMERIC(10,3);
  v_reason            TEXT;
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
      SELECT quantity INTO v_new_display_qty FROM display_stock WHERE product_id = p_product_id;
      SELECT current_stock INTO v_new_bo_stock FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'product_id',         p_product_id,
        'new_display_stock',  COALESCE(v_new_display_qty, 0),
        'new_bo_stock',       COALESCE(v_new_bo_stock, 0),
        'idempotent_replay',  TRUE
      );
    END IF;
  END IF;

  SELECT is_display_item, COALESCE(unit, 'pcs')
    INTO v_is_display, v_unit
    FROM products
   WHERE id = p_product_id;
  IF v_is_display IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_display = FALSE THEN
    RAISE EXCEPTION 'not_a_display_item' USING ERRCODE = 'P0002';
  END IF;

  SELECT quantity INTO v_current_qty
    FROM display_stock
   WHERE product_id = p_product_id
   FOR UPDATE;
  IF v_current_qty IS NULL OR v_current_qty < p_quantity THEN
    RAISE EXCEPTION 'insufficient_display_stock' USING ERRCODE = 'P0002';
  END IF;

  v_reason := COALESCE(NULLIF(TRIM(p_reason), ''), 'Display waste');
  IF length(v_reason) < 3 THEN
    v_reason := 'Display waste';
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'waste', -p_quantity, v_reason, v_profile_id, p_idempotency_key
    );

    UPDATE display_stock
       SET quantity = quantity - p_quantity,
           updated_at = now()
     WHERE product_id = p_product_id
    RETURNING quantity INTO v_new_display_qty;

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, unit, reason, reference_type, created_by
    ) VALUES (
      p_product_id, 'waste', -p_quantity, v_unit, v_reason, 'display_waste', v_profile_id
    );

    UPDATE products
       SET current_stock = current_stock - p_quantity
     WHERE id = p_product_id
    RETURNING current_stock INTO v_new_bo_stock;

    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  v_new_display_qty,
      'new_bo_stock',       v_new_bo_stock,
      'idempotent_replay',  FALSE
    );

  EXCEPTION WHEN unique_violation THEN
    SELECT quantity INTO v_new_display_qty FROM display_stock WHERE product_id = p_product_id;
    SELECT current_stock INTO v_new_bo_stock FROM products WHERE id = p_product_id;
    RETURN jsonb_build_object(
      'product_id',         p_product_id,
      'new_display_stock',  COALESCE(v_new_display_qty, 0),
      'new_bo_stock',       COALESCE(v_new_bo_stock, 0),
      'idempotent_replay',  TRUE
    );
  END;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.waste_display_stock_v1(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.waste_display_stock_v1(uuid, numeric, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.waste_display_stock_v1(uuid, numeric, text, uuid) IS
  'Perte vitrine. Gate display.manage. Double déduction display_stock + current_stock (peut passer '
  'négatif, pas de garde BO). INSERT direct stock_movements waste → JE via tr_20_je_emit.';
