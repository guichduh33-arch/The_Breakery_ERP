-- 20260618000019_create_remove_order_item_v1_rpc.sql
-- Session 33 / Wave 1.7 — remove an order item from an open order.

CREATE OR REPLACE FUNCTION public.remove_order_item_v1(
  p_order_item_id   UUID,
  p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_order_id  UUID;
  v_status    TEXT;
  v_replay    JSONB;
  v_result    JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN
    RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'remove';
  IF FOUND THEN RETURN v_replay; END IF;

  SELECT oi.order_id, o.status INTO v_order_id, v_status
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.id = p_order_item_id
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM order_items WHERE id = p_order_item_id;
  PERFORM _recalc_order_totals(v_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.remove', 'order', v_order_id,
          jsonb_build_object('order_item_id', p_order_item_id));

  v_result := jsonb_build_object('order_totals',
    (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total)
     FROM orders WHERE id = v_order_id));

  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result)
  VALUES (p_idempotency_key, 'remove', v_order_id, v_result);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_order_item_v1 TO authenticated;
COMMENT ON FUNCTION public.remove_order_item_v1 IS 'S33 — Remove one item from an open order. Audit-logged. Idempotent.';
