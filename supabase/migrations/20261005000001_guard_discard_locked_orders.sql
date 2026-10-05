-- Corps live de discard_held_order, relevé V3 le 2026-10-05.
-- ADR-010 : une ligne envoyée passe exclusivement par l'annulation protégée.
CREATE OR REPLACE FUNCTION public.discard_held_order_v3(p_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();
  v_uid       UUID := auth.uid();
  v_order_no  TEXT;
  v_was_held  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'orders.void') THEN
    RAISE EXCEPTION 'Permission denied: orders.void' USING ERRCODE = 'P0003';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_too_short' USING ERRCODE = 'P0001';
  END IF;

  SELECT order_number, is_held INTO v_order_no, v_was_held
  FROM orders
  WHERE id = p_order_id
    AND status IN ('draft', 'pending_payment')
    AND (is_held = true OR created_via = 'pos')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM id FROM order_items WHERE order_id = p_order_id ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM order_items WHERE order_id = p_order_id AND is_locked) THEN
    RAISE EXCEPTION 'locked_order_requires_cancellation' USING ERRCODE = '23514';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'order.held_discarded', 'orders', p_order_id,
          jsonb_build_object('reason', p_reason, 'order_number', v_order_no, 'was_held', v_was_held));

  DELETE FROM orders WHERE id = p_order_id;
END $function$;

REVOKE ALL ON FUNCTION public.discard_held_order_v3(uuid, text) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_held_order_v3(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.discard_held_order_v3(uuid, text) IS
  'Abandon sans ligne verrouillée, motif >= 10 caractères, porte orders.void ; une commande envoyée exige annulation protégée et déclaration de perte.';
DROP FUNCTION public.discard_held_order_v2(uuid, text);
