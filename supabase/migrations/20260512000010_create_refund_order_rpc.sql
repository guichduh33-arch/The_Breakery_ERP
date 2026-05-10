-- 20260512000009_create_refund_order_rpc.sql
-- Session 10 — refund_order_rpc (partial line refund).
-- Manager-PIN gated (pos.sale.refund). Order remains status='paid'. Multiple
-- partial refunds per order allowed as long as Σrefunds.total ≤ orders.total.
-- Per-tender routing capped by per-method paid less per-method already-refunded.
--
-- Loyalty earned : pro-rata deducted (refund_total / order.total ratio applied to original earned).
-- Loyalty redeemed : NOT restored on partial refund (acquis du décision V0 — full void only).
-- Stock : restored per refund_lines.qty via stock_movements (sale_void) + UPDATE products.

CREATE OR REPLACE FUNCTION refund_order_rpc(
  p_order_id      UUID,
  p_lines         JSONB,    -- [{order_item_id, qty}]
  p_tenders       JSONB,    -- [{method, amount, reference?}]
  p_reason        TEXT,
  p_authorized_by UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id          UUID;
  v_profile_id       UUID;
  v_order            RECORD;
  v_open_session     UUID;
  v_line_entry       JSONB;
  v_oi_id            UUID;
  v_oi               RECORD;
  v_qty_req          DECIMAL(14,3);
  v_qty_already      DECIMAL(14,3);
  v_amount_line      DECIMAL(14,2);
  v_refund_total     DECIMAL(14,2) := 0;
  v_tax_rate         DECIMAL(5,4);
  v_tax_refunded     DECIMAL(14,2);
  v_prior_refunds    DECIMAL(14,2);
  v_tender_entry     JSONB;
  v_tender_method    payment_method;
  v_tender_amt       DECIMAL(14,2);
  v_tender_sum       DECIMAL(14,2) := 0;
  v_method_paid      DECIMAL(14,2);
  v_method_refunded  DECIMAL(14,2);
  v_refund_id        UUID;
  v_refund_number    TEXT;
  v_seq_number       INTEGER;
  v_loyalty_now      INTEGER;
  v_pts_to_deduct    INTEGER := 0;
  v_loyalty_ratio    DECIMAL(8,4);
  v_product_id       UUID;
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
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.refund') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.refund' USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'Cannot refund % order', v_order.status USING ERRCODE = 'check_violation';
  END IF;

  -- Window
  SELECT id INTO v_open_session FROM pos_sessions
    WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN
    RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.session_id <> v_open_session THEN
    RAISE EXCEPTION 'Cross-shift refund not allowed in v1' USING ERRCODE = 'P0011';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 1 THEN
    RAISE EXCEPTION 'At least one line required' USING ERRCODE = 'check_violation';
  END IF;

  -- Validate lines (qty available + compute refund amounts)
  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id   := (v_line_entry->>'order_item_id')::UUID;
    v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);

    SELECT * INTO v_oi FROM order_items WHERE id = v_oi_id;
    IF v_oi.id IS NULL OR v_oi.order_id <> p_order_id THEN
      RAISE EXCEPTION 'Order item % not in order %', v_oi_id, p_order_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_oi.is_cancelled THEN
      RAISE EXCEPTION 'Cannot refund cancelled item %', v_oi_id USING ERRCODE = 'check_violation';
    END IF;
    IF v_qty_req <= 0 OR v_qty_req > v_oi.quantity THEN
      RAISE EXCEPTION 'Invalid qty for item % (max %)', v_oi_id, v_oi.quantity
        USING ERRCODE = 'check_violation';
    END IF;

    -- Already refunded check
    SELECT COALESCE(SUM(qty), 0) INTO v_qty_already
      FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id
      WHERE rl.order_item_id = v_oi_id;

    IF v_qty_already + v_qty_req > v_oi.quantity THEN
      RAISE EXCEPTION 'Refund qty (%) + already refunded (%) exceeds line qty (%) for item %',
        v_qty_req, v_qty_already, v_oi.quantity, v_oi_id USING ERRCODE = 'check_violation';
    END IF;

    -- Refund line amount = pro-rata of line_total
    v_amount_line  := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity);
    v_refund_total := v_refund_total + v_amount_line;
  END LOOP;

  -- Cap : Σrefunds for this order ≤ orders.total
  SELECT COALESCE(SUM(total), 0) INTO v_prior_refunds
    FROM refunds WHERE order_id = p_order_id;
  IF v_prior_refunds + v_refund_total > v_order.total THEN
    RAISE EXCEPTION 'Refund total (% prior + % new) exceeds order total %',
      v_prior_refunds, v_refund_total, v_order.total USING ERRCODE = 'check_violation';
  END IF;

  -- Validate tenders
  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) < 1 THEN
    RAISE EXCEPTION 'At least one tender required' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    v_tender_method := (v_tender_entry->>'method')::payment_method;
    v_tender_amt    := (v_tender_entry->>'amount')::DECIMAL(14,2);

    IF v_tender_amt <= 0 THEN
      RAISE EXCEPTION 'Tender amount must be > 0' USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(amount),0) INTO v_method_paid
      FROM order_payments WHERE order_id = p_order_id AND method = v_tender_method;
    SELECT COALESCE(SUM(rp.amount),0) INTO v_method_refunded
      FROM refund_payments rp JOIN refunds r ON r.id = rp.refund_id
      WHERE r.order_id = p_order_id AND rp.method = v_tender_method;

    IF v_method_refunded + v_tender_amt > v_method_paid THEN
      RAISE EXCEPTION 'Refund tender % (%) + prior (%) exceeds method paid (%)',
        v_tender_method, v_tender_amt, v_method_refunded, v_method_paid
        USING ERRCODE = 'check_violation';
    END IF;

    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;

  IF v_tender_sum <> v_refund_total THEN
    RAISE EXCEPTION 'Sum of refund tenders (%) != refund total (%)', v_tender_sum, v_refund_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- Tax refunded (PB1 inclusive)
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;
  v_tax_refunded := round_idr(v_refund_total * v_tax_rate / (1 + v_tax_rate));

  -- Generate refund_number
  INSERT INTO refund_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = refund_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded,
                       reason, refunded_by, authorized_by, is_full_void)
  VALUES (v_refund_number, p_order_id, v_open_session, v_refund_total, v_tax_refunded,
          p_reason, v_profile_id, p_authorized_by, false)
  RETURNING id INTO v_refund_id;

  -- INSERT refund_lines + restore stock
  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id   := (v_line_entry->>'order_item_id')::UUID;
    v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);

    SELECT line_total, quantity, product_id
      INTO v_oi FROM order_items WHERE id = v_oi_id;
    v_amount_line := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity);
    v_product_id  := v_oi.product_id;

    INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
    VALUES (v_refund_id, v_oi_id, v_qty_req, v_amount_line);

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    ) VALUES (
      v_product_id, 'sale_void', v_qty_req, 'refunds', v_refund_id, v_profile_id
    );

    UPDATE products SET
      current_stock = current_stock + v_qty_req,
      updated_at    = now()
    WHERE id = v_product_id;
  END LOOP;

  -- INSERT refund_payments
  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference)
    VALUES (
      v_refund_id,
      (v_tender_entry->>'method')::payment_method,
      (v_tender_entry->>'amount')::DECIMAL(14,2),
      NULLIF(v_tender_entry->>'reference','')
    );
  END LOOP;

  -- Loyalty earned pro-rata reversal
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 AND v_order.total > 0 THEN
    v_loyalty_ratio := v_refund_total::DECIMAL / v_order.total::DECIMAL;
    v_pts_to_deduct := FLOOR(v_order.loyalty_points_earned * v_loyalty_ratio);

    IF v_pts_to_deduct > 0 THEN
      UPDATE customers SET
        loyalty_points  = GREATEST(0, loyalty_points  - v_pts_to_deduct),
        lifetime_points = GREATEST(0, lifetime_points - v_pts_to_deduct),
        total_spent     = GREATEST(0, total_spent - v_refund_total),
        updated_at      = now()
      WHERE id = v_order.customer_id
      RETURNING loyalty_points INTO v_loyalty_now;

      INSERT INTO loyalty_transactions (
        customer_id, order_id, transaction_type, points,
        points_balance_after, description, created_by
      ) VALUES (
        v_order.customer_id, p_order_id, 'refund',
        -v_pts_to_deduct, v_loyalty_now,
        'Refund ' || v_refund_number || ' on order ' || v_order.order_number, v_profile_id
      );
    END IF;
  END IF;

  -- trg_create_je_for_refund auto-fires after this transaction → JE-REF-XXXX

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.refund', 'orders', p_order_id, jsonb_build_object(
    'refund_id',         v_refund_id,
    'refund_number',     v_refund_number,
    'order_number',      v_order.order_number,
    'total_refunded',    v_refund_total,
    'tax_refunded',      v_tax_refunded,
    'reason',            p_reason,
    'authorized_by',     p_authorized_by,
    'lines_count',       jsonb_array_length(p_lines),
    'tenders_count',     jsonb_array_length(p_tenders),
    'pts_deducted',      v_pts_to_deduct
  ));

  RETURN jsonb_build_object(
    'refund_id',      v_refund_id,
    'refund_number',  v_refund_number,
    'order_id',       p_order_id,
    'order_number',   v_order.order_number,
    'total_refunded', v_refund_total,
    'tax_refunded',   v_tax_refunded,
    'tenders',        p_tenders,
    'pts_deducted',   v_pts_to_deduct
  );
END $$;

GRANT EXECUTE ON FUNCTION refund_order_rpc TO authenticated;

COMMENT ON FUNCTION refund_order_rpc IS
  'Session 10: partial line refund of a paid order. Manager-PIN gate (pos.sale.refund). Cap = orders.total. Per-tender routing capped by per-method paid less prior. Pro-rata loyalty earned deduction. Cross-shift forbidden (P0011).';
