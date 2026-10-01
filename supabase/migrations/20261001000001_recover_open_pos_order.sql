-- Reprise d'une commande caisse impayée déjà ouverte : même snapshot, sans duplication.
-- Corps initial relevé sur V3 dev avec pg_get_functiondef le 2026-10-01.
CREATE FUNCTION public.reopen_held_order_v4(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_order RECORD;
  v_actor_profile UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  -- Le même verrou protège l'éligibilité, le changement de hold et le snapshot.
  SELECT id, is_held INTO v_order
    FROM orders
   WHERE id = p_order_id
     AND status = 'pending_payment'
     AND (is_held = true OR created_via = 'pos')
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_available_for_reopen' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.is_held THEN
    UPDATE orders SET is_held = false WHERE id = p_order_id;
  END IF;

  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.reopened', 'orders', p_order_id,
      jsonb_build_object('recovered_open_order', NOT v_order.is_held));

  RETURN get_pos_order_snapshot_v1(p_order_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_held_order_v4(uuid) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_held_order_v4(uuid) TO authenticated, service_role;
DROP FUNCTION public.reopen_held_order_v3(uuid);
