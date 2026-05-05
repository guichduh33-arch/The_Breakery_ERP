-- 20260506000005_extend_complete_order_rpc_table_number.sql
-- Session 4 — extend complete_order_with_payment (v4) to accept p_table_number TEXT DEFAULT NULL.
-- The table_number is stored on the orders row so KDS + reports can display the dine-in table.
-- Decision: Option A — ALTER the RPC signature (atomic, preferred over post-hoc UPDATE in EF).

CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id              UUID,
  p_order_type              order_type,
  p_items                   JSONB,
  p_payment                 JSONB,
  p_idempotency_key         UUID    DEFAULT NULL,
  p_customer_id             UUID    DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER DEFAULT 0,
  p_table_number            TEXT    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id              UUID;
  v_profile_id           UUID;
  v_order_id             UUID;
  v_order_number         TEXT;
  v_seq_number           INTEGER;
  v_subtotal             DECIMAL(12,2) := 0;
  v_tax_amount           DECIMAL(12,2) := 0;
  v_tax_rate             DECIMAL(5,4);
  v_item                 JSONB;
  v_product              RECORD;
  v_payment_method       payment_method;
  v_product_id           UUID;
  v_quantity             DECIMAL(10,3);
  v_unit_price           DECIMAL(12,2);
  v_modifiers            JSONB;
  v_modifiers_per_unit   DECIMAL(12,2);
  v_modifiers_total      DECIMAL(12,2);
  v_line_total           DECIMAL(12,2);
  v_dispatch_station     TEXT;
  v_redemption_amount    DECIMAL(12,2) := 0;
  v_total                DECIMAL(12,2);
  v_loyalty_balance      INTEGER;
  v_points_earned        INTEGER := 0;
  v_je_id                UUID;
  v_loyalty_liab_id      UUID;
  v_sale_discount_id     UUID;
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

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order_id FROM orders WHERE idempotency_key = p_idempotency_key;
    IF v_order_id IS NOT NULL THEN
      RETURN (
        SELECT jsonb_build_object(
          'order_id', id,
          'order_number', order_number,
          'subtotal', subtotal,
          'tax_amount', tax_amount,
          'total', total,
          'change_given', NULL,
          'idempotent_replay', true
        ) FROM orders WHERE id = v_order_id
      );
    END IF;
  END IF;

  -- 1. Verify session
  IF NOT EXISTS (
    SELECT 1 FROM pos_sessions
      WHERE id = p_session_id
        AND opened_by = v_profile_id
        AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'No open session for this user' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Loyalty redeem guards
  IF p_loyalty_points_redeemed > 0 THEN
    IF p_customer_id IS NULL THEN
      RAISE EXCEPTION 'Cannot redeem points without customer attached'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_loyalty_points_redeemed % 100 <> 0 THEN
      RAISE EXCEPTION 'Points must be a multiple of 100'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT loyalty_points INTO v_loyalty_balance
      FROM customers WHERE id = p_customer_id;
    IF v_loyalty_balance < p_loyalty_points_redeemed THEN
      RAISE EXCEPTION 'Insufficient loyalty points (balance: %)', v_loyalty_balance
        USING ERRCODE = 'P0010';
    END IF;
    v_redemption_amount := p_loyalty_points_redeemed * 10;
  END IF;

  -- 3. Lock products + check stock
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

  -- 4. Compute subtotal with modifiers
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  v_subtotal := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_line_total := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);
    v_subtotal   := v_subtotal + v_line_total;
  END LOOP;

  v_total := v_subtotal - v_redemption_amount;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Redemption exceeds order total' USING ERRCODE = 'check_violation';
  END IF;

  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));

  -- 5. Generate order_number
  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  -- 6. INSERT order (v4: includes table_number)
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total,
    customer_id, loyalty_points_redeemed, loyalty_redemption_amount,
    idempotency_key, paid_at, table_number
  ) VALUES (
    v_order_number, p_session_id, v_profile_id, p_order_type, 'paid',
    v_subtotal, v_tax_amount, v_total,
    p_customer_id, p_loyalty_points_redeemed, v_redemption_amount,
    p_idempotency_key, now(), p_table_number
  ) RETURNING id INTO v_order_id;

  -- 7. Append loyalty JE lines when redemption > 0
  IF v_redemption_amount > 0 THEN
    SELECT id INTO v_je_id
      FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = v_order_id;

    SELECT id INTO v_loyalty_liab_id FROM accounts WHERE code = '2210' AND is_active;
    SELECT id INTO v_sale_discount_id FROM accounts WHERE code = '4900' AND is_active;

    IF v_je_id IS NOT NULL AND v_loyalty_liab_id IS NOT NULL AND v_sale_discount_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_loyalty_liab_id, v_redemption_amount, 0, 'Loyalty redemption — DR liability'),
        (v_je_id, v_sale_discount_id, 0, v_redemption_amount, 'Loyalty redemption — CR discount');

      UPDATE journal_entries
        SET total_debit  = total_debit  + v_redemption_amount,
            total_credit = total_credit + v_redemption_amount
        WHERE id = v_je_id;
    END IF;
  END IF;

  -- 8. INSERT order_items + stock_movements
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);

    SELECT c.dispatch_station
      INTO v_dispatch_station
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station
    FROM products p WHERE p.id = v_product_id;

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    ) VALUES (
      v_product_id, 'sale', -v_quantity, 'orders', v_order_id, v_profile_id
    );

    UPDATE products
      SET current_stock = current_stock - v_quantity,
          updated_at = now()
      WHERE id = v_product_id;
  END LOOP;

  -- 9. INSERT payment
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

  -- 10. Loyalty redeem — decrement balance + insert txn
  IF p_loyalty_points_redeemed > 0 THEN
    UPDATE customers
      SET loyalty_points = loyalty_points - p_loyalty_points_redeemed,
          updated_at     = now()
      WHERE id = p_customer_id;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      p_customer_id, v_order_id, 'redeem', -p_loyalty_points_redeemed,
      v_loyalty_balance - p_loyalty_points_redeemed,
      'Redemption on order ' || v_order_id::text, v_profile_id
    );
  END IF;

  -- 11. Loyalty earn on v_total (post-redemption)
  IF p_customer_id IS NOT NULL AND v_total > 0 THEN
    v_points_earned := FLOOR(v_total / 1000);

    IF v_points_earned > 0 THEN
      UPDATE customers SET
        loyalty_points  = loyalty_points  + v_points_earned,
        lifetime_points = lifetime_points + v_points_earned,
        total_spent     = total_spent     + v_total,
        total_visits    = total_visits    + 1,
        last_visit_at   = now(),
        updated_at      = now()
      WHERE id = p_customer_id;

      INSERT INTO loyalty_transactions (
        customer_id, order_id, transaction_type, points,
        points_balance_after, order_amount, description, created_by
      ) VALUES (
        p_customer_id, v_order_id, 'earn', v_points_earned,
        (SELECT loyalty_points FROM customers WHERE id = p_customer_id),
        v_total, 'Earned on order ' || v_order_id::text, v_profile_id
      );

      UPDATE orders SET loyalty_points_earned = v_points_earned WHERE id = v_order_id;

    ELSE
      UPDATE customers SET
        total_spent  = total_spent + v_total,
        total_visits = total_visits + 1,
        last_visit_at = now(),
        updated_at    = now()
      WHERE id = p_customer_id;
    END IF;
  END IF;

  -- 12. Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.complete', 'orders', v_order_id, jsonb_build_object(
      'order_number',   v_order_number,
      'subtotal',       v_subtotal,
      'total',          v_total,
      'redemption',     v_redemption_amount,
      'payment_method', p_payment->>'method',
      'table_number',   p_table_number
    ));

  -- 13. Return
  RETURN jsonb_build_object(
    'order_id',               v_order_id,
    'order_number',           v_order_number,
    'subtotal',               v_subtotal,
    'tax_amount',             v_tax_amount,
    'total',                  v_total,
    'loyalty_redemption_amount', v_redemption_amount,
    'loyalty_points_earned',  v_points_earned,
    'loyalty_points_redeemed', p_loyalty_points_redeemed,
    'customer_id',            p_customer_id,
    'table_number',           p_table_number,
    'change_given',           NULLIF((p_payment->>'change_given'), '')::DECIMAL
  );
END $$;

GRANT EXECUTE ON FUNCTION complete_order_with_payment TO authenticated;

COMMENT ON FUNCTION complete_order_with_payment IS
  'RPC central transactionnel (session 4) : v3 + table_number forwarded to orders INSERT.';
