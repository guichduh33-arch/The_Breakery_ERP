-- 20260618000017_create_update_order_item_qty_v1_rpc.sql
-- Session 33 / Wave 1.6 — update qty on an order item of an open order.

CREATE OR REPLACE FUNCTION public.update_order_item_qty_v1(
  p_order_item_id   UUID,
  p_qty             INT,
  p_idempotency_key UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_order_id   UUID;
  v_status     TEXT;
  v_unit_price NUMERIC;
  v_replay     JSONB;
  v_result     JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN
    RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;

  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive (use remove_order_item_v1 for 0)' USING ERRCODE = '22023';
  END IF;

  SELECT oi.order_id, o.status, oi.unit_price INTO v_order_id, v_status, v_unit_price
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

  -- NOTE: actual column is `quantity` (NUMERIC), not `qty`
  UPDATE order_items SET quantity = p_qty, line_total = v_unit_price * p_qty
  WHERE id = p_order_item_id;

  PERFORM _recalc_order_totals(v_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.update_qty', 'order', v_order_id,
          jsonb_build_object('order_item_id', p_order_item_id, 'new_qty', p_qty));

  v_result := jsonb_build_object('order_totals',
    (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total)
     FROM orders WHERE id = v_order_id));

  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result)
  VALUES (p_idempotency_key, 'update_qty', v_order_id, v_result);

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v1 TO authenticated;
COMMENT ON FUNCTION public.update_order_item_qty_v1 IS 'S33 — Update qty of one item on an open order. Audit-logged. Idempotent.';
