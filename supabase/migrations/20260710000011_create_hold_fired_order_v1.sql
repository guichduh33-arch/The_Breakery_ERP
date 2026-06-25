-- 20260710000011_create_hold_fired_order_v1.sql
-- Spec A, Bloc 2 — park a FIRED counter order (pending_payment) in the held list
-- by flagging is_held=true, so Send-to-Kitchen can free the terminal while the
-- order stays alive in the DB ("addition ouverte"). Additive _v1; does NOT touch
-- fire_counter_order_v4. Idempotent (setting is_held=true twice is harmless).
-- Gate: pos.sale.create (CASHIER+). REVOKE pair S25.
CREATE OR REPLACE FUNCTION public.hold_fired_order_v1(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_actor_profile UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  UPDATE orders
     SET is_held = true
   WHERE id = p_order_id
     AND status = 'pending_payment'
     AND created_via = 'pos';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fired_order_not_found_or_not_holdable' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.held', 'orders', p_order_id, '{}'::jsonb);
END $function$;

REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
