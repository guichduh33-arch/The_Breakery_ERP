-- 20260510000005_extend_pay_existing_order_rpc_v3.sql
-- Session 8 — perf-debt fix D1 (suite).
-- v3 = v2 (20260508000004) avec merge des deux loops sur order_items :
--   v2 loop 1 (lock+stock-check, lignes 119-131) + v2 loop 2 (INSERT stock_movements + UPDATE products, lignes 175-190)
--   → UN seul FOR loop. Le SELECT FOR UPDATE OF p de v2 a déjà lock les products ; v3 économise
--     une 2e passe + 2e lock/UPDATE par item.
-- Iso-comportement : tout reste dans la même transaction ; le JE trigger sur UPDATE orders ne lit
-- pas stock_movements, donc déplacer le decrement avant ou après le UPDATE orders est neutre.
-- Choix : on garde la position du loop 1 (pre-UPDATE orders) et on y fold les opérations du loop 2.
-- Stock-check fail-fast préservé (avant UPDATE orders + JE creation).

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'pay_existing_order' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION pay_existing_order(
  p_order_id                UUID,
  p_payment                 JSONB,
  p_customer_id             UUID             DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER          DEFAULT 0,
  p_idempotency_key         UUID             DEFAULT NULL,
  p_discount_amount         DECIMAL(14,2)    DEFAULT 0,
  p_discount_type           TEXT             DEFAULT NULL,
  p_discount_value          DECIMAL(14,2)    DEFAULT NULL,
  p_discount_reason         TEXT             DEFAULT NULL,
  p_discount_authorized_by  UUID             DEFAULT NULL,
  p_loyalty_multiplier      DECIMAL(4,2)     DEFAULT 1.0
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_profile_id         UUID;
  v_order              orders;
  v_items_total        DECIMAL(14,2) := 0;
  v_tax_rate           DECIMAL(5,4);
  v_redemption_amount  DECIMAL(14,2) := 0;
  v_total              DECIMAL(14,2);
  v_tax_amount         DECIMAL(14,2);
  v_loyalty_balance    INTEGER;
  v_points_earned      INTEGER := 0;
  v_payment_method     payment_method;
  v_je_id              UUID;
  v_loyalty_liab_id    UUID;
  v_sale_discount_id   UUID;
  v_item               RECORD;
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

  IF NOT has_permission(v_user_id, 'payments.process') THEN
    RAISE EXCEPTION 'Permission denied: payments.process' USING ERRCODE = 'P0003';
  END IF;

  -- Idempotency replay
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order.id FROM orders WHERE idempotency_key = p_idempotency_key;
    IF v_order.id IS NOT NULL THEN
      RETURN v_order.id;
    END IF;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Order is not in draft status (current: %)', v_order.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Loyalty redeem guards
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

  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  -- items_total = SUM of existing order_items.line_total (already includes line-level discounts)
  SELECT COALESCE(SUM(line_total), 0)
    INTO v_items_total
    FROM order_items
    WHERE order_id = p_order_id;

  v_total := v_items_total - v_redemption_amount - p_discount_amount;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts exceed items total' USING ERRCODE = 'check_violation';
  END IF;

  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));

  -- MERGED LOOP (v3) : lock + stock-check + INSERT stock_movements + UPDATE products en UN passage.
  -- v2 faisait deux passes séparées (lignes 119-131 + 175-190), chacune locking products. v3 combine :
  -- le SELECT FOR UPDATE OF p lock le product, on vérifie stock, puis on émet stock_movement et
  -- décrémente — tout en un seul pass. Iso-comportement : opérations toutes dans la même tx,
  -- le JE trigger (UPDATE orders ci-dessous) ne lit pas stock_movements.
  -- Stock-check fail-fast préservé : si insufficient → RAISE avant l'UPDATE orders → rollback de tout.
  FOR v_item IN
    SELECT oi.product_id, oi.quantity, p.name, p.current_stock
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = p_order_id
      FOR UPDATE OF p
  LOOP
    IF v_item.current_stock < v_item.quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
        v_item.name, v_item.current_stock, v_item.quantity
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    ) VALUES (
      v_item.product_id, 'sale', -v_item.quantity, 'orders', p_order_id, v_profile_id
    );

    UPDATE products
      SET current_stock = current_stock - v_item.quantity,
          updated_at    = now()
      WHERE id = v_item.product_id;
  END LOOP;

  -- UPDATE orders to 'paid' — triggers create_sale_journal_entry() AFTER UPDATE
  UPDATE orders SET
    status                    = 'paid',
    paid_at                   = now(),
    customer_id               = p_customer_id,
    loyalty_points_redeemed   = p_loyalty_points_redeemed,
    loyalty_redemption_amount = v_redemption_amount,
    subtotal                  = v_items_total,
    tax_amount                = v_tax_amount,
    total                     = v_total,
    idempotency_key           = p_idempotency_key,
    served_by                 = v_profile_id,
    discount_amount           = p_discount_amount,
    discount_type             = p_discount_type,
    discount_value            = p_discount_value,
    discount_reason           = p_discount_reason,
    discount_authorized_by    = p_discount_authorized_by,
    updated_at                = now()
    WHERE id = p_order_id;

  -- Append loyalty JE lines when redemption > 0
  IF v_redemption_amount > 0 THEN
    SELECT id INTO v_je_id
      FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = p_order_id;

    SELECT id INTO v_loyalty_liab_id FROM accounts WHERE code = '2210' AND is_active;
    SELECT id INTO v_sale_discount_id FROM accounts WHERE code = '4900' AND is_active;

    IF v_je_id IS NOT NULL AND v_loyalty_liab_id IS NOT NULL AND v_sale_discount_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_loyalty_liab_id, v_redemption_amount, 0,                  'Loyalty redemption — DR liability'),
        (v_je_id, v_sale_discount_id, 0,                   v_redemption_amount, 'Loyalty redemption — CR discount');

      UPDATE journal_entries
        SET total_debit  = total_debit  + v_redemption_amount,
            total_credit = total_credit + v_redemption_amount
        WHERE id = v_je_id;
    END IF;
  END IF;

  -- INSERT payment
  v_payment_method := (p_payment->>'method')::payment_method;
  INSERT INTO order_payments (
    order_id, method, amount, cash_received, change_given
  ) VALUES (
    p_order_id,
    v_payment_method,
    (p_payment->>'amount')::DECIMAL,
    NULLIF((p_payment->>'cash_received'), '')::DECIMAL,
    NULLIF((p_payment->>'change_given'), '')::DECIMAL
  );

  -- Loyalty redeem: decrement balance + insert txn
  IF p_loyalty_points_redeemed > 0 THEN
    UPDATE customers
      SET loyalty_points = loyalty_points - p_loyalty_points_redeemed,
          updated_at     = now()
      WHERE id = p_customer_id;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      p_customer_id, p_order_id, 'redeem', -p_loyalty_points_redeemed,
      v_loyalty_balance - p_loyalty_points_redeemed,
      'Redemption on order ' || p_order_id::text, v_profile_id
    );
  END IF;

  -- Loyalty earn on v_total with multiplier
  IF p_customer_id IS NOT NULL AND v_total > 0 THEN
    v_points_earned := FLOOR(v_total * p_loyalty_multiplier / 1000);

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
        p_customer_id, p_order_id, 'earn', v_points_earned,
        (SELECT loyalty_points FROM customers WHERE id = p_customer_id),
        v_total, 'Earned on order ' || p_order_id::text, v_profile_id
      );

      UPDATE orders SET loyalty_points_earned = v_points_earned WHERE id = p_order_id;

    ELSE
      UPDATE customers SET
        total_spent  = total_spent + v_total,
        total_visits = total_visits + 1,
        last_visit_at = now(),
        updated_at    = now()
      WHERE id = p_customer_id;
    END IF;
  END IF;

  -- Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.pay_existing', 'orders', p_order_id, jsonb_build_object(
      'order_number',    v_order.order_number,
      'items_total',     v_items_total,
      'total',           v_total,
      'redemption',      v_redemption_amount,
      'discount_amount', p_discount_amount,
      'payment_method',  p_payment->>'method'
    ));

  RETURN p_order_id;
END $$;

GRANT EXECUTE ON FUNCTION pay_existing_order TO authenticated;

COMMENT ON FUNCTION pay_existing_order IS
  'Session 8 v3 (perf-debt D1): merge stock-check loop + stock_movements/products UPDATE loop en UN passage. Iso v2 — gain : 1 lock par produit au lieu de 2.';
