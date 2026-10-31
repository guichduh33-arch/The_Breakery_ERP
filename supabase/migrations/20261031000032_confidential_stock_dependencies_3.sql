CREATE OR REPLACE FUNCTION public.reopen_held_order_v7(p_order_id uuid, p_session_id uuid DEFAULT NULL::uuid)
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
     AND ((status = 'pending_payment' AND created_via = 'pos')
       OR (status = 'draft' AND created_via = 'tablet'
         AND session_id = p_session_id AND p_session_id IS NOT NULL))
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

  RETURN get_pos_order_snapshot_v3(p_order_id);
END;
$function$
;
DROP FUNCTION public.reopen_held_order_v6(p_order_id uuid, p_session_id uuid);
REVOKE ALL ON FUNCTION public.reopen_held_order_v7(p_order_id uuid, p_session_id uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reopen_held_order_v7(p_order_id uuid, p_session_id uuid) TO authenticated;

