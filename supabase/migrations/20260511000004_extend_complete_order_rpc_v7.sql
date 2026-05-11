-- 20260511000004_extend_complete_order_rpc_v7.sql
-- Session 9 — extend complete_order_with_payment to v7.
-- v7 = v6 (20260510000004) + auto-evaluated promotions.
-- New behaviour:
--   - Param p_promotions JSONB DEFAULT '[]'::jsonb — array of {promotion_id, amount, description}
--   - Server-side validates each promotion (active, not deleted, date/dow/hour, min total, customer category)
--   - Inserts promotion_applications rows
--   - orders.promotion_total = SUM(amount)
--   - v_total = v_items_total - v_redemption_amount - p_discount_amount - v_promotion_total
--   - v_tax_amount recomputed on the new v_total (tax-inclusive)
--   - Free-product gift items are passed through p_items with is_promo_gift=true + promotion_id
--     (cart store auto-adds them client-side ; server simply tags the order_item row)
--
-- ISO-COMPORTEMENT WITH v6 : when p_promotions IS NULL OR jsonb_array_length(p_promotions)=0,
-- the promo loop is a no-op, v_promotion_total stays 0, the totals collapse to v6's formula
-- (v_total = v_items_total - v_redemption_amount - p_discount_amount), tax recompute is identical,
-- promotion_applications has no INSERTs, orders.promotion_total stays at its DEFAULT 0,
-- and order_items inserts pass through is_promo_gift=false / promotion_id=NULL (defaults).

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'complete_order_with_payment' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id              UUID,
  p_order_type              order_type,
  p_items                   JSONB,
  p_payment                 JSONB,
  p_idempotency_key         UUID             DEFAULT NULL,
  p_customer_id             UUID             DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER          DEFAULT 0,
  p_table_number            TEXT             DEFAULT NULL,
  p_discount_amount         DECIMAL(14,2)    DEFAULT 0,
  p_discount_type           TEXT             DEFAULT NULL,
  p_discount_value          DECIMAL(14,2)    DEFAULT NULL,
  p_discount_reason         TEXT             DEFAULT NULL,
  p_discount_authorized_by  UUID             DEFAULT NULL,
  p_loyalty_multiplier      DECIMAL(4,2)     DEFAULT 1.0,
  p_promotions              JSONB            DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id              UUID;
  v_profile_id           UUID;
  v_order_id             UUID;
  v_order_number         TEXT;
  v_seq_number           INTEGER;
  v_items_total          DECIMAL(14,2) := 0;
  v_tax_amount           DECIMAL(14,2) := 0;
  v_tax_rate             DECIMAL(5,4);
  v_item                 JSONB;
  v_product              RECORD;
  v_payment_method       payment_method;
  v_product_id           UUID;
  v_quantity             DECIMAL(10,3);
  v_unit_price           DECIMAL(14,2);
  v_modifiers            JSONB;
  v_modifiers_per_unit   DECIMAL(14,2);
  v_modifiers_total      DECIMAL(14,2);
  v_line_discount        DECIMAL(14,2);
  v_line_total           DECIMAL(14,2);
  v_dispatch_station     TEXT;
  v_redemption_amount    DECIMAL(14,2) := 0;
  v_total                DECIMAL(14,2);
  v_loyalty_balance      INTEGER;
  v_points_earned        INTEGER := 0;
  v_je_id                UUID;
  v_loyalty_liab_id      UUID;
  v_sale_discount_id     UUID;
  -- Session 9 promotion locals
  v_promo                JSONB;
  v_promotion_total      DECIMAL(14,2) := 0;
  v_promo_id             UUID;
  v_promo_amount         DECIMAL(14,2);
  v_promo_record         promotions;
  v_customer_category_id UUID;
  v_now                  TIMESTAMPTZ := now();
  v_now_dow              INTEGER;
  v_now_hour             INTEGER;
  v_item_promo_id        UUID;
  v_item_is_gift         BOOLEAN;
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
          'order_id',        id,
          'order_number',    order_number,
          'subtotal',        subtotal,
          'tax_amount',      tax_amount,
          'total',           total,
          'change_given',    NULL,
          'idempotent_replay', true
        ) FROM orders WHERE id = v_order_id
      );
    END IF;
  END IF;

  -- Verify session
  IF NOT EXISTS (
    SELECT 1 FROM pos_sessions
      WHERE id = p_session_id
        AND opened_by = v_profile_id
        AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'No open session for this user' USING ERRCODE = 'P0001';
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

  -- MERGED LOOP (v6) : lock + stock-check + compute items_total in one pass over p_items.
  v_items_total := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
      FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id' USING ERRCODE = 'P0002';
    END IF;

    v_quantity := (v_item->>'quantity')::DECIMAL;

    IF v_product.current_stock < v_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
        v_product.name, v_product.current_stock, v_quantity
        USING ERRCODE = 'P0002';
    END IF;

    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(14,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_line_discount := COALESCE((v_item->>'discount_amount')::DECIMAL(14,2), 0);
    v_line_total    := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity) - v_line_discount;
    v_items_total   := v_items_total + v_line_total;
  END LOOP;

  -- Session 9 — server-side promotion validation (no-op if p_promotions empty/null).
  -- We re-verify each promo's eligibility against the live DB now() to defend against
  -- client-side time drift / stale cache (spec §7 risk : Server re-eval drift).
  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    v_now_dow  := EXTRACT(ISODOW FROM v_now)::INTEGER;   -- 1=Mon..7=Sun (Postgres ISO)
    v_now_hour := EXTRACT(HOUR  FROM v_now)::INTEGER;

    -- Resolve customer's category once (used by all customer-restricted promos).
    IF p_customer_id IS NOT NULL THEN
      SELECT category_id INTO v_customer_category_id
        FROM customers WHERE id = p_customer_id;
    END IF;

    FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
      v_promo_id     := (v_promo->>'promotion_id')::UUID;
      v_promo_amount := (v_promo->>'amount')::DECIMAL(14,2);

      IF v_promo_amount IS NULL OR v_promo_amount < 0 THEN
        RAISE EXCEPTION 'Invalid promotion amount for %: %', v_promo_id, v_promo_amount
          USING ERRCODE = 'check_violation';
      END IF;

      SELECT * INTO v_promo_record FROM promotions
        WHERE id = v_promo_id AND is_active = true AND deleted_at IS NULL;
      IF v_promo_record.id IS NULL THEN
        RAISE EXCEPTION 'Promotion not found or inactive: %', v_promo_id
          USING ERRCODE = 'check_violation';
      END IF;

      -- Date range
      IF v_promo_record.start_at IS NOT NULL AND v_promo_record.start_at > v_now THEN
        RAISE EXCEPTION 'Promotion not yet active: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_promo_record.end_at IS NOT NULL AND v_promo_record.end_at < v_now THEN
        RAISE EXCEPTION 'Promotion expired: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;

      -- Day-of-week mask : ISODOW returns 1..7 (Mon..Sun), we use bit (n-1).
      IF (v_promo_record.day_of_week_mask & (1 << (v_now_dow - 1))) = 0 THEN
        RAISE EXCEPTION 'Promotion not valid this day: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;

      -- Hour range (start inclusive, end exclusive — matches client matchHour semantics)
      IF v_promo_record.start_hour IS NOT NULL THEN
        IF v_now_hour < v_promo_record.start_hour
           OR v_now_hour >= v_promo_record.end_hour THEN
          RAISE EXCEPTION 'Promotion not valid this hour: %', v_promo_record.slug
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      -- Min items total
      IF v_items_total < v_promo_record.min_items_total THEN
        RAISE EXCEPTION 'Promotion min total not met: % (required %)',
          v_promo_record.slug, v_promo_record.min_items_total
          USING ERRCODE = 'check_violation';
      END IF;

      -- Customer category restriction
      IF array_length(v_promo_record.customer_category_ids, 1) > 0 THEN
        IF p_customer_id IS NULL THEN
          RAISE EXCEPTION 'Promotion requires customer: %', v_promo_record.slug
            USING ERRCODE = 'check_violation';
        END IF;
        IF v_customer_category_id IS NULL
           OR NOT (v_customer_category_id = ANY (v_promo_record.customer_category_ids)) THEN
          RAISE EXCEPTION 'Promotion not valid for this customer category: %', v_promo_record.slug
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      v_promotion_total := v_promotion_total + v_promo_amount;
    END LOOP;
  END IF;

  v_total := v_items_total - v_redemption_amount - p_discount_amount - v_promotion_total;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts + promotions exceed items total' USING ERRCODE = 'check_violation';
  END IF;

  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));

  -- Generate order_number
  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  -- INSERT order (v7: + promotion_total)
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total,
    customer_id, loyalty_points_redeemed, loyalty_redemption_amount,
    idempotency_key, paid_at, table_number,
    discount_amount, discount_type, discount_value, discount_reason, discount_authorized_by,
    promotion_total
  ) VALUES (
    v_order_number, p_session_id, v_profile_id, p_order_type, 'paid',
    v_items_total, v_tax_amount, v_total,
    p_customer_id, p_loyalty_points_redeemed, v_redemption_amount,
    p_idempotency_key, now(), p_table_number,
    p_discount_amount, p_discount_type, p_discount_value, p_discount_reason, p_discount_authorized_by,
    v_promotion_total
  ) RETURNING id INTO v_order_id;

  -- Append loyalty JE lines when redemption > 0 (trigger already created the base JE)
  IF v_redemption_amount > 0 THEN
    SELECT id INTO v_je_id
      FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = v_order_id;

    SELECT id INTO v_loyalty_liab_id FROM accounts WHERE code = '2210' AND is_active;
    SELECT id INTO v_sale_discount_id FROM accounts WHERE code = '4900' AND is_active;

    IF v_je_id IS NOT NULL AND v_loyalty_liab_id IS NOT NULL AND v_sale_discount_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_loyalty_liab_id, v_redemption_amount, 0,                 'Loyalty redemption — DR liability'),
        (v_je_id, v_sale_discount_id, 0,                  v_redemption_amount, 'Loyalty redemption — CR discount');

      UPDATE journal_entries
        SET total_debit  = total_debit  + v_redemption_amount,
            total_credit = total_credit + v_redemption_amount
        WHERE id = v_je_id;
    END IF;
  END IF;

  -- Loop 3 (kept separate) : INSERT order_items + stock_movements + UPDATE products.
  -- v7 : pass through is_promo_gift + promotion_id from p_items (NULL/false defaults if absent).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(14,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_discount   := COALESCE((v_item->>'discount_amount')::DECIMAL(14,2), 0);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity) - v_line_discount;

    -- v7 : extract gift flags (default false / NULL preserves v6 behaviour for non-gift items)
    v_item_is_gift  := COALESCE((v_item->>'is_promo_gift')::BOOLEAN, false);
    v_item_promo_id := NULLIF(v_item->>'promotion_id', '')::UUID;

    SELECT c.dispatch_station
      INTO v_dispatch_station
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station,
      discount_amount, discount_type, discount_value, discount_reason,
      is_promo_gift, promotion_id
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station,
      v_line_discount,
      NULLIF(v_item->>'discount_type', ''),
      CASE WHEN (v_item->>'discount_value') IS NOT NULL AND (v_item->>'discount_value') <> ''
           THEN (v_item->>'discount_value')::DECIMAL(14,2)
           ELSE NULL END,
      NULLIF(v_item->>'discount_reason', ''),
      v_item_is_gift,
      v_item_promo_id
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

  -- Session 9 — INSERT promotion_applications rows (no-op if p_promotions empty/null).
  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
      INSERT INTO promotion_applications (order_id, promotion_id, amount, description)
      VALUES (
        v_order_id,
        (v_promo->>'promotion_id')::UUID,
        (v_promo->>'amount')::DECIMAL(14,2),
        COALESCE(v_promo->>'description', '')
      );
    END LOOP;
  END IF;

  -- INSERT payment
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
      p_customer_id, v_order_id, 'redeem', -p_loyalty_points_redeemed,
      v_loyalty_balance - p_loyalty_points_redeemed,
      'Redemption on order ' || v_order_id::text, v_profile_id
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

  -- Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.complete', 'orders', v_order_id, jsonb_build_object(
      'order_number',    v_order_number,
      'items_total',     v_items_total,
      'total',           v_total,
      'redemption',      v_redemption_amount,
      'discount_amount', p_discount_amount,
      'promotion_total', v_promotion_total,
      'payment_method',  p_payment->>'method',
      'table_number',    p_table_number
    ));

  RETURN jsonb_build_object(
    'order_id',                  v_order_id,
    'order_number',              v_order_number,
    'subtotal',                  v_items_total,
    'tax_amount',                v_tax_amount,
    'total',                     v_total,
    'discount_amount',           p_discount_amount,
    'promotion_total',           v_promotion_total,
    'loyalty_redemption_amount', v_redemption_amount,
    'loyalty_points_earned',     v_points_earned,
    'loyalty_points_redeemed',   p_loyalty_points_redeemed,
    'customer_id',               p_customer_id,
    'table_number',              p_table_number,
    'change_given',              NULLIF((p_payment->>'change_given'), '')::DECIMAL
  );
END $$;

GRANT EXECUTE ON FUNCTION complete_order_with_payment TO authenticated;

COMMENT ON FUNCTION complete_order_with_payment IS
  'Session 9 v7: adds p_promotions JSONB. Server-side validates eligibility (active, date/dow/hour, min total, customer category) ; inserts promotion_applications ; orders.promotion_total = SUM ; v_total = items - redemption - manual_discount - promo_total ; tax recomputed on v_total. Iso-comportement v6 when p_promotions IS NULL or empty.';
