-- 20260512000007_create_cancel_order_item_rpc.sql
-- Session 10 — cancel_order_item_rpc.
-- Soft-cancels an order_item that has been sent to the kitchen but not served.
-- Manager-PIN gate: caller must be authenticated (any session-bearing user) AND
-- p_authorized_by must hold pos.sale.cancel_item permission. Recomputes order
-- subtotal/tax/total to exclude the cancelled line. No stock/loyalty effect
-- because the order is still draft (stock decrement happens at status='paid').

CREATE OR REPLACE FUNCTION cancel_order_item_rpc(
  p_order_item_id UUID,
  p_reason        TEXT,
  p_authorized_by UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order_id       UUID;
  v_order_status   order_status;
  v_kitchen_status TEXT;
  v_is_cancelled   BOOLEAN;
  v_dispatch       TEXT;
  v_order_number   TEXT;
  v_name           TEXT;
  v_new_subtotal   DECIMAL(14,2);
  v_new_tax        DECIMAL(14,2);
  v_new_total      DECIMAL(14,2);
  v_tax_rate       DECIMAL(5,4);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_authorized_by IS NULL THEN
    RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003';
  END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.cancel_item') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.cancel_item'
      USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT oi.order_id, o.status, oi.kitchen_status, oi.is_cancelled,
         oi.dispatch_station, o.order_number, oi.name_snapshot
    INTO v_order_id, v_order_status, v_kitchen_status, v_is_cancelled,
         v_dispatch, v_order_number, v_name
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = p_order_item_id
    FOR UPDATE OF oi;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order_status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot cancel item on % order (use refund flow)', v_order_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_kitchen_status = 'served' THEN
    RAISE EXCEPTION 'Cannot cancel served item (use refund flow)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_is_cancelled THEN
    RAISE EXCEPTION 'Item already cancelled' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE order_items SET
    is_cancelled     = true,
    cancelled_at     = now(),
    cancelled_reason = p_reason,
    cancelled_by     = p_authorized_by
  WHERE id = p_order_item_id;

  -- Recompute order totals (exclude cancelled lines)
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_new_subtotal
    FROM order_items
    WHERE order_id = v_order_id AND is_cancelled = false;

  -- Draft order : no checkout-time discounts/promotions/redemption applied yet,
  -- so total == subtotal at this stage. Tax extracted PB1 inclusive.
  v_new_total := v_new_subtotal;
  v_new_tax   := round_idr(v_new_total * v_tax_rate / (1 + v_tax_rate));

  UPDATE orders
    SET subtotal   = v_new_subtotal,
        tax_amount = v_new_tax,
        total      = v_new_total,
        updated_at = now()
    WHERE id = v_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.cancel_item', 'order_items', p_order_item_id, jsonb_build_object(
    'order_id',         v_order_id,
    'order_number',     v_order_number,
    'item_name',        v_name,
    'reason',           p_reason,
    'authorized_by',    p_authorized_by,
    'dispatch_station', v_dispatch,
    'new_subtotal',     v_new_subtotal,
    'new_total',        v_new_total
  ));

  RETURN jsonb_build_object(
    'order_item_id',    p_order_item_id,
    'order_id',         v_order_id,
    'order_number',     v_order_number,
    'item_name',        v_name,
    'dispatch_station', v_dispatch,
    'new_subtotal',     v_new_subtotal,
    'new_tax_amount',   v_new_tax,
    'new_total',        v_new_total
  );
END $$;

GRANT EXECUTE ON FUNCTION cancel_order_item_rpc TO authenticated;

COMMENT ON FUNCTION cancel_order_item_rpc IS
  'Session 10: cancel a draft order item (post-send_to_kitchen). Manager-PIN gate. Recomputes order totals excluding cancelled. No stock/loyalty effect (still draft).';
