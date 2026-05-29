-- 20260618000023_fix_edit_items_rpc_status_enum.sql
-- Session 33 / Wave 4 corrective — fix status enum check in the 3 edit-item RPCs.
-- Was: IN ('draft', 'open') ; correct: IN ('draft', 'pending_payment')
--
-- Discovered by Wave 4.2 pgTAP — order_status enum has no 'open' value.
-- Actual values: draft, paid, voided, pending_payment, completed, b2b_pending.
-- Editable statuses are the pre-settlement ones: draft + pending_payment.
--
-- Also fixes Task 1.5 RPC body to use products.retail_price (not .price —
-- the schema discovery from Wave 1.5).

CREATE OR REPLACE FUNCTION public.add_order_item_v1(
  p_order_id         UUID,
  p_product_id       UUID,
  p_qty              INT,
  p_modifiers        JSONB,
  p_idempotency_key  UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_status        TEXT;
  v_product       RECORD;
  v_line_total    NUMERIC;
  v_order_item_id UUID;
  v_replay        JSONB;
  v_result        JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN
    RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501';
  END IF;

  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;

  SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002';
  END IF;
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive' USING ERRCODE = '22023';
  END IF;

  SELECT id, name, retail_price AS price, cost_price INTO v_product
  FROM products WHERE id = p_product_id AND is_active = true;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  v_line_total := v_product.price * p_qty;

  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers)
  VALUES (p_order_id, v_product.id, v_product.name, p_qty, v_product.price, v_line_total, COALESCE(p_modifiers, '[]'::jsonb))
  RETURNING id INTO v_order_item_id;

  PERFORM _recalc_order_totals(p_order_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'order.item.add', 'order', p_order_id,
          jsonb_build_object('order_item_id', v_order_item_id, 'product_id', v_product.id, 'qty', p_qty));

  v_result := jsonb_build_object('order_item_id', v_order_item_id,
    'order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total)
                     FROM orders WHERE id = p_order_id));

  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result)
  VALUES (p_idempotency_key, 'add', p_order_id, v_result);

  RETURN v_result;
END;
$$;

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
  IF v_status NOT IN ('draft', 'pending_payment') THEN
    RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002';
  END IF;

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
  IF v_status NOT IN ('draft', 'pending_payment') THEN
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
