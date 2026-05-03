-- 20260503000008_init_complete_order_rpc.sql
-- Phase 2 / migration 9 : RPC central transactionnel

CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id UUID,
  p_order_type order_type,
  p_items      JSONB,        -- [{product_id: uuid, quantity: number, unit_price: number}]
  p_payment    JSONB         -- {method, amount, cash_received?, change_given?}
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order_id       UUID;
  v_order_number   TEXT;
  v_seq_number     INTEGER;
  v_subtotal       DECIMAL(12,2) := 0;
  v_tax_amount     DECIMAL(12,2) := 0;
  v_tax_rate       DECIMAL(5,4);
  v_item           JSONB;
  v_product        RECORD;
  v_payment_method payment_method;
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

  IF NOT has_permission(v_user_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  -- 1. Verify session ouverte appartient au caller
  IF NOT EXISTS (
    SELECT 1 FROM pos_sessions
      WHERE id = p_session_id
        AND opened_by = v_profile_id
        AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'No open session for this user' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock products + check stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
      FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id' USING ERRCODE = 'P0002';
    END IF;

    IF v_product.current_stock < (v_item->>'quantity')::DECIMAL THEN
      RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
        v_product.name, v_product.current_stock, (v_item->>'quantity')::DECIMAL
        USING ERRCODE = 'P0002';
    END IF;
  END LOOP;

  -- 3. Compute totals (PB1 incluse extraite)
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  SELECT COALESCE(SUM(round_idr((value->>'unit_price')::DECIMAL * (value->>'quantity')::DECIMAL)), 0)
    INTO v_subtotal
    FROM jsonb_array_elements(p_items);

  v_tax_amount := round_idr(v_subtotal * v_tax_rate / (1 + v_tax_rate));

  -- 4. Génère order_number (séquence quotidienne)
  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  -- 5. INSERT order
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total, paid_at
  ) VALUES (
    v_order_number, p_session_id, v_profile_id, p_order_type, 'paid',
    v_subtotal, v_tax_amount, v_subtotal, now()
  ) RETURNING id INTO v_order_id;

  -- 6. INSERT order_items + stock_movements + decrement
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total
    )
    SELECT
      v_order_id,
      p.id,
      p.name,
      (v_item->>'unit_price')::DECIMAL,
      (v_item->>'quantity')::DECIMAL,
      round_idr((v_item->>'unit_price')::DECIMAL * (v_item->>'quantity')::DECIMAL)
    FROM products p WHERE p.id = (v_item->>'product_id')::UUID;

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    ) VALUES (
      (v_item->>'product_id')::UUID,
      'sale',
      -(v_item->>'quantity')::DECIMAL,
      'orders',
      v_order_id,
      v_profile_id
    );

    UPDATE products
      SET current_stock = current_stock - (v_item->>'quantity')::DECIMAL,
          updated_at = now()
      WHERE id = (v_item->>'product_id')::UUID;
  END LOOP;

  -- 7. INSERT payment
  v_payment_method := (p_payment->>'method')::payment_method;
  INSERT INTO order_payments (
    order_id, method, amount, cash_received, change_given
  ) VALUES (
    v_order_id,
    v_payment_method,
    (p_payment->>'amount')::DECIMAL,
    NULLIF((p_payment->>'cash_received'), '')::DECIMAL,
    NULLIF((p_payment->>'change_given'), '')::DECIMAL
  );

  -- 8. Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.complete', 'orders', v_order_id, jsonb_build_object(
      'order_number', v_order_number,
      'total', v_subtotal,
      'payment_method', p_payment->>'method'
    ));

  -- 9. Return
  RETURN jsonb_build_object(
    'order_id',     v_order_id,
    'order_number', v_order_number,
    'subtotal',     v_subtotal,
    'tax_amount',   v_tax_amount,
    'total',        v_subtotal,
    'change_given', NULLIF((p_payment->>'change_given'), '')::DECIMAL
  );
END $$;

-- Permission GRANT pour authenticated role
GRANT EXECUTE ON FUNCTION complete_order_with_payment TO authenticated;

COMMENT ON FUNCTION complete_order_with_payment IS
  'RPC central transactionnel : lock + check stock, génère order_number, insert order + items + payment + stock_movements + audit. SECURITY DEFINER bypass les RLS INSERT.';
