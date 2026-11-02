-- Correction ciblée : transférer uniquement un ticket entièrement impayé.
-- Base : corps production de reopen_held_order_v6 relu via pg_get_functiondef.
-- v8 existe en développement ; v9 évite de réutiliser une version publiée.
CREATE FUNCTION public.reopen_held_order_v9(p_order_id uuid, p_session_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_profile uuid;
  v_previous_session uuid;
  v_order orders%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_actor_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL AND is_active;

  SELECT session_id INTO v_previous_session FROM orders WHERE id = p_order_id;
  -- Même ordre de verrous que la clôture : sessions avant commande.
  PERFORM id FROM pos_sessions
    WHERE id IN (p_session_id, v_previous_session) ORDER BY id FOR SHARE;
  IF p_session_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM pos_sessions
    WHERE id = p_session_id AND status = 'open' AND opened_by = v_actor_profile
  ) THEN
    RAISE EXCEPTION 'no_open_shift' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM orders
    WHERE id = p_order_id
      AND ((status = 'pending_payment' AND created_via = 'pos')
        OR (status = 'draft' AND created_via = 'tablet' AND sent_to_kitchen_at IS NOT NULL))
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_available_for_reopen' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.session_id IS DISTINCT FROM v_previous_session THEN
    RAISE EXCEPTION 'order_shift_changed_retry' USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM order_payments WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'order_already_has_payments' USING ERRCODE = 'P0002';
  END IF;
  IF v_previous_session IS DISTINCT FROM p_session_id AND EXISTS (
    SELECT 1 FROM pos_sessions WHERE id = v_previous_session AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'order_shift_still_open' USING ERRCODE = 'P0002';
  END IF;

  UPDATE orders SET session_id = p_session_id, is_held = false, updated_at = now()
    WHERE id = p_order_id;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.reopened', 'orders', p_order_id,
      jsonb_build_object('recovered_open_order', NOT v_order.is_held,
        'origin_session_id', v_previous_session, 'receiving_session_id', p_session_id,
        'shift_transferred', v_previous_session IS DISTINCT FROM p_session_id));

  -- Les deux bases ont des lecteurs publics différents ; conserver leurs
  -- contrôles d'accès et leur format sans installer l'évolution financière dev.
  IF to_regprocedure('public.get_pos_order_snapshot_v4(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.get_pos_order_snapshot_v4($1)' INTO v_snapshot USING p_order_id;
  ELSE
    EXECUTE 'SELECT public.get_pos_order_snapshot_v2($1)' INTO v_snapshot USING p_order_id;
  END IF;
  RETURN v_snapshot;
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_held_order_v9(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_held_order_v9(uuid, uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
