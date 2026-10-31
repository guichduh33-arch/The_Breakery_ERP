CREATE FUNCTION stock_private.mask_stock_payload(p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_result jsonb; v_key text; v_value jsonb;
BEGIN
 IF public.can_view_business_day_v1(current_date) THEN RETURN p_value; END IF;
 IF jsonb_typeof(p_value)='object' THEN
   v_result:='{}';
   FOR v_key,v_value IN SELECT key,value FROM jsonb_each(p_value) LOOP
     IF v_key IN ('current_stock','new_current_stock','new_bo_stock','new_display_stock',
       'available_after','material_stock','stock_before','stock_after','shortages') THEN
       v_result:=v_result||jsonb_build_object(v_key,NULL);
     ELSE v_result:=v_result||jsonb_build_object(v_key,stock_private.mask_stock_payload(v_value)); END IF;
   END LOOP;
   RETURN v_result;
 ELSIF jsonb_typeof(p_value)='array' THEN
   SELECT COALESCE(jsonb_agg(stock_private.mask_stock_payload(value) ORDER BY ord),'[]'::jsonb)
   INTO v_result FROM jsonb_array_elements(p_value) WITH ORDINALITY e(value,ord);
   RETURN v_result;
 END IF;
 RETURN p_value;
END $$;
REVOKE ALL ON FUNCTION stock_private.mask_stock_payload(jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.add_display_stock_v2(p_product_id uuid, p_quantity numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
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
  v_movement_id       UUID;
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
        'idempotent_replay',  TRUE
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, created_by, idempotency_key
    ) VALUES (
      p_product_id, 'stock_in', p_quantity, p_reason, v_profile_id, p_idempotency_key
    ) RETURNING id INTO v_movement_id;

    INSERT INTO display_stock (product_id, quantity, updated_at)
    VALUES (p_product_id, p_quantity, now())
    ON CONFLICT (product_id) DO UPDATE
      SET quantity   = display_stock.quantity + EXCLUDED.quantity,
          updated_at = now()
    RETURNING quantity INTO v_new_qty;

    -- v2 (F4) : audit_logs trace le QUI ; display_movements traçait déjà le QUOI.
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES (
      'display.add', 'display_movement', v_movement_id,
      jsonb_build_object(
        'product_id',        p_product_id,
        'quantity',          p_quantity,
        'reason',            p_reason,
        'new_display_stock', v_new_qty,
        'idempotency_key',   p_idempotency_key
      ),
      v_profile_id
    );

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
$function$
;
REVOKE ALL ON FUNCTION stock_private.add_display_stock_v2(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.add_display_stock_v3(p_product_id uuid, p_quantity numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.add_display_stock_v2(p_product_id,p_quantity,p_reason,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.add_display_stock_v2(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid);
REVOKE ALL ON FUNCTION public.add_display_stock_v3(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_display_stock_v3(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.get_pos_order_snapshot_v2(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    has_permission(auth.uid(), 'pos.sale.create') OR has_permission(auth.uid(), 'sales.create')
  ) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
  RETURN public._pos_order_snapshot_data_v1(p_order_id);
END;
$function$
;
REVOKE ALL ON FUNCTION stock_private.get_pos_order_snapshot_v2(p_order_id uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_pos_order_snapshot_v3(p_order_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 IF NOT public.can_view_order_v1(p_order_id) THEN RAISE EXCEPTION 'business_day_not_released' USING ERRCODE='P0003'; END IF;
 RETURN stock_private.mask_stock_payload(stock_private.get_pos_order_snapshot_v2(p_order_id));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.get_pos_order_snapshot_v2(p_order_id uuid);
REVOKE ALL ON FUNCTION public.get_pos_order_snapshot_v3(p_order_id uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_snapshot_v3(p_order_id uuid) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.record_incoming_stock_v2(p_product_id uuid, p_quantity numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT stock_private.mutate('incoming',p_product_id,p_quantity,p_reason,p_supplier_id,p_unit_cost,p_idempotency_key)
$function$
;
REVOKE ALL ON FUNCTION stock_private.record_incoming_stock_v2(p_product_id uuid, p_quantity numeric, p_supplier_id uuid, p_unit_cost numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_incoming_stock_v3(p_product_id uuid, p_quantity numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.record_incoming_stock_v2(p_product_id,p_quantity,p_supplier_id,p_unit_cost,p_reason,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.record_incoming_stock_v2(p_product_id uuid, p_quantity numeric, p_supplier_id uuid, p_unit_cost numeric, p_reason text, p_idempotency_key uuid);
REVOKE ALL ON FUNCTION public.record_incoming_stock_v3(p_product_id uuid, p_quantity numeric, p_supplier_id uuid, p_unit_cost numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_incoming_stock_v3(p_product_id uuid, p_quantity numeric, p_supplier_id uuid, p_unit_cost numeric, p_reason text, p_idempotency_key uuid) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.reservation_hold_v1(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid DEFAULT NULL::uuid, p_holder_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_current   NUMERIC(10,3);
  v_held      NUMERIC(10,3);
  v_avail     NUMERIC(10,3);
  v_res_id    UUID;
  v_replay    BOOLEAN := FALSE;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_holder_type IS NULL OR p_holder_type NOT IN ('cart','tablet','b2b_order') THEN
    RAISE EXCEPTION 'invalid_holder_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at_must_be_future' USING ERRCODE = 'P0001';
  END IF;

  -- Resolve profile (audit_log + RLS context).
  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_profile FROM user_profiles
      WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  END IF;

  -- Idempotent replay.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_res_id FROM stock_reservations
      WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF FOUND THEN
      v_replay := TRUE;
      SELECT current_stock INTO v_current FROM products WHERE id = p_product_id;
      SELECT COALESCE(SUM(quantity), 0) INTO v_held
        FROM stock_reservations
        WHERE product_id = p_product_id
          AND status = 'held'
          AND expires_at > now();
      RETURN jsonb_build_object(
        'reservation_id', v_res_id,
        'product_id', p_product_id,
        'quantity', p_quantity,
        'available_after', GREATEST(0, v_current - v_held),
        'idempotent_replay', TRUE
      );
    END IF;
  END IF;

  -- Availability check (lock product row for FOR UPDATE consistency).
  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(quantity), 0) INTO v_held
    FROM stock_reservations
    WHERE product_id = p_product_id
      AND status = 'held'
      AND expires_at > now();

  v_avail := v_current - v_held;
  IF v_avail < p_quantity THEN
    RAISE EXCEPTION 'insufficient_available_stock' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO stock_reservations (
    product_id, quantity, holder_id, holder_type,
    expires_at, status, notes, idempotency_key, created_by
  ) VALUES (
    p_product_id, p_quantity, p_holder_id, p_holder_type,
    p_expires_at, 'held', p_notes, p_idempotency_key, v_profile
  ) RETURNING id INTO v_res_id;

  -- Audit log.
  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'stock.reservation.hold', 'stock_reservations', v_res_id,
    jsonb_build_object(
      'product_id', p_product_id,
      'quantity', p_quantity,
      'holder_type', p_holder_type,
      'holder_id', p_holder_id,
      'expires_at', p_expires_at,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'reservation_id', v_res_id,
    'product_id', p_product_id,
    'quantity', p_quantity,
    'available_after', v_avail - p_quantity,
    'idempotent_replay', FALSE
  );
END $function$
;
REVOKE ALL ON FUNCTION stock_private.reservation_hold_v1(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid, p_holder_id uuid, p_notes text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.reservation_hold_v2(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid DEFAULT NULL::uuid, p_holder_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.reservation_hold_v1(p_product_id,p_quantity,p_holder_type,p_expires_at,p_section_id,p_holder_id,p_notes,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.reservation_hold_v1(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid, p_holder_id uuid, p_notes text, p_idempotency_key uuid);
REVOKE ALL ON FUNCTION public.reservation_hold_v2(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid, p_holder_id uuid, p_notes text, p_idempotency_key uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reservation_hold_v2(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid, p_holder_id uuid, p_notes text, p_idempotency_key uuid) TO authenticated;

-- Corps live copié sans accès direct ; sortie filtrée par la nouvelle signature.
CREATE OR REPLACE FUNCTION stock_private.return_display_to_kitchen_v2(p_product_id uuid, p_quantity numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile_id        UUID;
  v_existing_movement UUID;
  v_movement_id       UUID;
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
    ) RETURNING id INTO v_movement_id;

    UPDATE display_stock
       SET quantity = quantity - p_quantity,
           updated_at = now()
     WHERE product_id = p_product_id
    RETURNING quantity INTO v_new_qty;

    -- v2 (F4) : sortie de vitrine sans contrepartie de vente — elle doit nommer son auteur.
    INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
    VALUES (
      'display.return_to_kitchen', 'display_movement', v_movement_id,
      jsonb_build_object(
        'product_id',        p_product_id,
        'quantity',          p_quantity,
        'reason',            p_reason,
        'new_display_stock', v_new_qty,
        'idempotency_key',   p_idempotency_key
      ),
      v_profile_id
    );

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
$function$
;
REVOKE ALL ON FUNCTION stock_private.return_display_to_kitchen_v2(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.return_display_to_kitchen_v3(p_product_id uuid, p_quantity numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $wrapper$
BEGIN
 
 RETURN stock_private.mask_stock_payload(stock_private.return_display_to_kitchen_v2(p_product_id,p_quantity,p_reason,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v1(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $wrapper$;
DROP FUNCTION public.return_display_to_kitchen_v2(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid);
REVOKE ALL ON FUNCTION public.return_display_to_kitchen_v3(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.return_display_to_kitchen_v3(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) TO authenticated;


