-- 20260817000008_adr027_fix_reservation_hold_mono_section.sql
--
-- ADR-027 correctif — reservation_hold_v1 insérait encore
-- stock_reservations.section_id, colonne droppée par 20260817000007 (le
-- late-binding plpgsql a masqué la référence jusqu'à la première exécution :
-- surfacé par le pgTAP de la PR). Corps repris du live pg_get_functiondef ;
-- signature INCHANGÉE (p_section_id conservé, ignoré — même précédent que
-- record_stock_movement_v1, 20260817000001). Seuls changements : l'INSERT ne
-- porte plus section_id, l'audit non plus.

CREATE OR REPLACE FUNCTION public.reservation_hold_v1(
  p_product_id uuid, p_quantity numeric, p_holder_type text,
  p_expires_at timestamp with time zone, p_section_id uuid DEFAULT NULL::uuid,
  p_holder_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid)
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
END $function$;

COMMENT ON FUNCTION public.reservation_hold_v1(uuid, numeric, text, timestamptz, uuid, uuid, text, uuid) IS
  'ADR-027 : réservation mono-section. p_section_id accepté mais ignoré '
  '(compat appelants) ; stock_reservations.section_id est droppée.';
