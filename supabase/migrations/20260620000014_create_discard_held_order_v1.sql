-- Session 35 — F-003 (Wave C4): discard_held_order_v1 + REVOKE pair.
-- Manager discards a held order (reason >= 10 chars). DELETE (not void) to avoid the
-- status->voided JE trigger on a draft with no JE. Gate: orders.void (MANAGER+).
-- The audit row preserves who/why/which order_number.
CREATE OR REPLACE FUNCTION public.discard_held_order_v1(p_order_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_order_no  TEXT;
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

  SELECT order_number INTO v_order_no
  FROM orders WHERE id = p_order_id AND is_held = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'order.held_discarded', 'orders', p_order_id,
          jsonb_build_object('reason', p_reason, 'order_number', v_order_no));

  DELETE FROM orders WHERE id = p_order_id;  -- cascades order_items + held_order_idempotency_keys
END $function$;

REVOKE EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.discard_held_order_v1(UUID, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
