-- 20260618000015_create_add_order_item_v1_rpc.sql
-- Session 33 / Wave 1.5 — add an item to an open order.

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

  -- Idempotency replay
  SELECT result INTO v_replay FROM order_edit_idempotency_keys
  WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;

  -- Status gate
  SELECT status::text INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002';
  END IF;
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'Quantity must be positive' USING ERRCODE = '22023';
  END IF;

  -- Resolve product (NB: products.retail_price is the selling price column)
  SELECT id, name, retail_price, cost_price INTO v_product
  FROM products WHERE id = p_product_id AND is_active = true;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'Product not found or inactive' USING ERRCODE = 'P0002';
  END IF;
  v_line_total := v_product.retail_price * p_qty;

  -- NB: order_items column is `quantity` (NUMERIC), not `qty`
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers)
  VALUES (p_order_id, v_product.id, v_product.name, p_qty, v_product.retail_price, v_line_total, COALESCE(p_modifiers, '[]'::jsonb))
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

GRANT EXECUTE ON FUNCTION public.add_order_item_v1 TO authenticated;
COMMENT ON FUNCTION public.add_order_item_v1 IS 'S33 — Add an item to an open order. Recalc totals. Audit-logged. Idempotent.';
