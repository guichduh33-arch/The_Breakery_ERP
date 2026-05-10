-- 20260512000008_create_void_order_rpc.sql
-- Session 10 — void_order_rpc.
-- Full void of a paid order. Manager-PIN gated (pos.sale.void). Window: order's
-- session_id must match the caller's currently-open pos_session.
--
-- Side-effects (atomic):
--   - UPDATE orders status='voided' + voided_at/by/reason → fires session 3 trigger that writes
--     JE-{order_number}-VOID (DR Sales + DR PB1 / CR Cash reversal).
--   - INSERT reversal stock_movements (sale_void) + restore products.current_stock for each
--     non-cancelled order_item.
--   - Reverse loyalty earned (UPDATE customers + INSERT loyalty_transactions 'refund' negative).
--   - Restore loyalty redeemed (UPDATE customers + INSERT loyalty_transactions 'refund' positive).
--   - INSERT a refunds row (is_full_void=true) mirroring the order ; mirror refund_payments 1:1
--     from order_payments. The trg_create_je_for_refund trigger then writes JE-REF-{refund_number}.
--     Both JEs (session 3 VOID + session 10 REFUND) co-exist for a full void → see spec §8.

CREATE OR REPLACE FUNCTION void_order_rpc(
  p_order_id      UUID,
  p_reason        TEXT,
  p_authorized_by UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order          RECORD;
  v_open_session   UUID;
  v_item           RECORD;
  v_loyalty_now    INTEGER;
  v_refund_id      UUID;
  v_refund_number  TEXT;
  v_seq_number     INTEGER;
  v_pay            RECORD;
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
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.void') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.void' USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'Cannot void % order (only paid orders)', v_order.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Window check : current open session must match order's session
  SELECT id INTO v_open_session FROM pos_sessions
    WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN
    RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.session_id <> v_open_session THEN
    RAISE EXCEPTION 'Cross-shift void not allowed in v1' USING ERRCODE = 'P0011';
  END IF;

  -- Update orders → fires session 3 trigger (paid → voided reverse JE).
  UPDATE orders SET
    status      = 'voided',
    voided_at   = now(),
    voided_by   = p_authorized_by,
    void_reason = p_reason,
    updated_at  = now()
  WHERE id = p_order_id;

  -- Restore stock for non-cancelled items
  FOR v_item IN SELECT id, product_id, quantity FROM order_items
                WHERE order_id = p_order_id AND is_cancelled = false LOOP
    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    ) VALUES (
      v_item.product_id, 'sale_void', v_item.quantity, 'orders', p_order_id, v_profile_id
    );
    UPDATE products SET
      current_stock = current_stock + v_item.quantity,
      updated_at    = now()
    WHERE id = v_item.product_id;
  END LOOP;

  -- Reverse loyalty earned (full)
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 THEN
    UPDATE customers SET
      loyalty_points  = GREATEST(0, loyalty_points  - v_order.loyalty_points_earned),
      lifetime_points = GREATEST(0, lifetime_points - v_order.loyalty_points_earned),
      total_spent     = GREATEST(0, total_spent - v_order.total),
      updated_at      = now()
    WHERE id = v_order.customer_id
    RETURNING loyalty_points INTO v_loyalty_now;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      v_order.customer_id, p_order_id, 'refund',
      -v_order.loyalty_points_earned,
      v_loyalty_now,
      'Reversal: void order ' || v_order.order_number, v_profile_id
    );
  END IF;

  -- Restore loyalty redeemed (full void only — partial refund leaves redemption attached)
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_redeemed > 0 THEN
    UPDATE customers SET
      loyalty_points = loyalty_points + v_order.loyalty_points_redeemed,
      updated_at     = now()
    WHERE id = v_order.customer_id
    RETURNING loyalty_points INTO v_loyalty_now;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      v_order.customer_id, p_order_id, 'refund',
      v_order.loyalty_points_redeemed,
      v_loyalty_now,
      'Restored redemption: void order ' || v_order.order_number, v_profile_id
    );
  END IF;

  -- Generate refund_number
  INSERT INTO refund_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = refund_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');

  -- Insert refunds row (audit mirror, is_full_void=true)
  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded,
                       reason, refunded_by, authorized_by, is_full_void)
  VALUES (v_refund_number, p_order_id, v_open_session, v_order.total, v_order.tax_amount,
          p_reason, v_profile_id, p_authorized_by, true)
  RETURNING id INTO v_refund_id;

  INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
  SELECT v_refund_id, id, quantity, line_total
    FROM order_items WHERE order_id = p_order_id AND is_cancelled = false;

  -- Mirror tenders 1:1 from order_payments → refund_payments
  FOR v_pay IN SELECT method, amount, reference FROM order_payments WHERE order_id = p_order_id LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference)
    VALUES (v_refund_id, v_pay.method, v_pay.amount, v_pay.reference);
  END LOOP;

  -- trg_create_je_for_refund auto-fires after this transaction → JE-REF-XXXX

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.void', 'orders', p_order_id, jsonb_build_object(
    'order_number',  v_order.order_number,
    'total_voided',  v_order.total,
    'reason',        p_reason,
    'authorized_by', p_authorized_by,
    'refund_id',     v_refund_id,
    'refund_number', v_refund_number
  ));

  RETURN jsonb_build_object(
    'order_id',       p_order_id,
    'order_number',   v_order.order_number,
    'refund_id',      v_refund_id,
    'refund_number',  v_refund_number,
    'total_refunded', v_order.total,
    'tax_refunded',   v_order.tax_amount,
    'tenders',        (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                       FROM refund_payments WHERE refund_id = v_refund_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION void_order_rpc TO authenticated;

COMMENT ON FUNCTION void_order_rpc IS
  'Session 10: full void of a paid order. Manager-PIN gate (pos.sale.void). Restores stock, reverses loyalty earned, restores loyalty redeemed. Inserts mirror refund row (is_full_void=true). Cross-shift forbidden (P0011).';
