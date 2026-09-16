CREATE OR REPLACE FUNCTION public.reopen_held_order_v3(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_order         RECORD;
  v_actor_profile UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  UPDATE orders
     SET is_held = false
   WHERE id = p_order_id
     AND is_held = true
     AND status = 'pending_payment'
   RETURNING id, order_number, order_type, customer_id, table_number, notes
     INTO v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found_or_already_open' USING ERRCODE = 'P0002';
  END IF;



  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.reopened', 'orders', p_order_id, '{}'::jsonb);

  RETURN get_pos_order_snapshot_v1(p_order_id);
END $function$;

REVOKE ALL ON FUNCTION public.reopen_held_order_v3(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_held_order_v3(uuid) TO authenticated, service_role;
DROP FUNCTION public.reopen_held_order_v2(uuid);
