-- Session 35 — F-003 (Wave C3): restore_held_order_v1 + REVOKE pair.
-- Returns the cart payload for rehydration, then DELETEs the held draft (items +
-- idempotency row cascade). DELETE avoids the status->voided JE trigger; the real
-- sale becomes a fresh order at checkout. Gate: pos.sale.create (CASHIER+).
CREATE OR REPLACE FUNCTION public.restore_held_order_v1(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    UUID := auth.uid();
  v_order  RECORD;
  v_items  JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, order_type, customer_id, table_number, notes
    INTO v_order
  FROM orders WHERE id = p_order_id AND is_held = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'product_id', oi.product_id,
           'name',       oi.name_snapshot,
           'quantity',   oi.quantity,
           'unit_price', oi.unit_price,
           'modifiers',  COALESCE(oi.modifiers, '[]'::jsonb)
         ) ORDER BY oi.created_at)
    INTO v_items
  FROM order_items oi WHERE oi.order_id = p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'order.held_restored', 'orders', p_order_id, '{}'::jsonb);

  DELETE FROM orders WHERE id = p_order_id;  -- cascades order_items + held_order_idempotency_keys

  RETURN jsonb_build_object(
    'order_id',   v_order.id,
    'order_type', v_order.order_type,
    'customerId', v_order.customer_id,
    'tableNumber',v_order.table_number,
    'notes',      v_order.notes,
    'items',      COALESCE(v_items, '[]'::jsonb)
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.restore_held_order_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_held_order_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.restore_held_order_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
