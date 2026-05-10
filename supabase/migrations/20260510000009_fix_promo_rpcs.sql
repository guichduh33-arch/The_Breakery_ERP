-- 20260510000009_fix_promo_rpcs.sql
-- Session 8 / migration 9 : fixes for the promotion-aware order RPCs.
-- Discovered via pgTAP integration tests (supabase/tests/promotions_rpcs.sql).
--
-- BUG #1 : evaluate_promotions reads `qty` from each item, but the app sends
--          `quantity` to create_tablet_order / complete_order_with_payment.
--          The orchestrator RPCs were forwarding p_items unchanged, so cart_total
--          / qty checks evaluated against NULL and produced false positives
--          (e.g. "Free Americano on 100k+" applied to a 35k cart).
--          Fix: build v_promo_input_items by mapping quantity → qty and
--          surfacing modifier_total + manual_discount_amount before calling
--          evaluate_promotions.
--
-- BUG #2 : The INSERT INTO order_items inside the items_to_add loop did not
--          set name_snapshot, which is NOT NULL on the table. Any BOGO or
--          free_product promo that reached this branch crashed with
--          "null value in column name_snapshot violates not-null constraint".
--          Fix: include name_snapshot via a SELECT from products.
--
-- These migrations replace the full bodies from migrations 5 and 7. No schema
-- changes; behaviour identical apart from the two fixes above.

-- ============================================================
-- create_tablet_order (replaces 20260510000007)
-- ============================================================
DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'create_tablet_order' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION create_tablet_order(
  p_session_id      UUID,
  p_table_number    TEXT,
  p_items           JSONB,
  p_customer_id     UUID DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL,
  p_evaluation_ts   TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_profile_id         UUID;
  v_order_id           UUID;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_product_id         UUID;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(14,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(14,2);
  v_modifiers_total    DECIMAL(14,2);
  v_line_total         DECIMAL(14,2);
  v_line_discount      DECIMAL(14,2);
  v_dispatch_station   TEXT;
  v_waiter_id          UUID;
  v_promo_input_items  JSONB;
  v_promo_result       JSONB;
  v_applied_promo      JSONB;
  v_promo_total        DECIMAL(14,2) := 0;
  v_items_to_add       JSONB := '[]'::JSONB;
  v_added_item         JSONB;
  v_split_from_existing BOOLEAN;
  v_promo_id_local     UUID;
  v_promo_name         TEXT;
  v_promo_action_type  promotion_action_type;
  v_promo_action_params JSONB;
  v_promo_slug         TEXT;
  v_promo_target       TEXT;
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

  IF NOT has_permission(v_user_id, 'sales.create') THEN
    RAISE EXCEPTION 'Permission denied: sales.create' USING ERRCODE = 'P0003';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order_id FROM orders WHERE idempotency_key = p_idempotency_key;
    IF v_order_id IS NOT NULL THEN
      RETURN jsonb_build_object('order_id', v_order_id, 'idempotent_replay', true);
    END IF;
  END IF;

  SELECT opened_by INTO v_waiter_id FROM pos_sessions WHERE id = p_session_id;

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO orders (
    order_number, order_type, status, created_via,
    session_id, waiter_id, table_number, customer_id,
    idempotency_key, sent_to_kitchen_at,
    subtotal, tax_amount, total, promotion_total_amount
  ) VALUES (
    v_order_number, 'dine_in', 'pending_payment', 'tablet',
    p_session_id, v_waiter_id, p_table_number, p_customer_id,
    p_idempotency_key, now(),
    0, 0, 0, 0
  ) RETURNING id INTO v_order_id;

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

    SELECT c.dispatch_station INTO v_dispatch_station
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station,
      discount_amount, discount_type, discount_value, discount_reason,
      is_locked, kitchen_status, sent_to_kitchen_at
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
      true, 'pending', now()
    FROM products p WHERE p.id = v_product_id;
  END LOOP;

  -- Bug #1 fix: shape p_items into the contract evaluate_promotions expects
  -- (qty + modifier_total + manual_discount_amount). The app sends `quantity`
  -- and modifiers as objects; evaluate_promotions reads `qty` and the
  -- pre-computed numeric totals.
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id',             item->>'product_id',
      'qty',                    (item->>'quantity')::DECIMAL,
      'unit_price',             (item->>'unit_price')::DECIMAL,
      'modifier_total',         COALESCE(
        (SELECT SUM((m->>'price_adjustment')::DECIMAL(14,2))
           FROM jsonb_array_elements(COALESCE(item->'modifiers', '[]'::jsonb)) m),
        0
      ) * (item->>'quantity')::DECIMAL,
      'manual_discount_amount', COALESCE((item->>'discount_amount')::DECIMAL(14,2), 0)
    )
  )
  INTO v_promo_input_items
  FROM jsonb_array_elements(p_items) item;

  v_promo_result := evaluate_promotions(v_promo_input_items, p_customer_id, p_evaluation_ts);
  v_applied_promo := v_promo_result->'applied_promotion';

  -- Bug #3 fix: jsonb 'null' IS NOT NULL evaluates true; check the json type instead.
  IF jsonb_typeof(v_applied_promo) = 'object' THEN
    v_promo_total       := (v_applied_promo->>'discount_amount')::DECIMAL;
    v_items_to_add      := v_applied_promo->'items_to_add';
    v_promo_id_local    := (v_applied_promo->>'promotion_id')::UUID;
    v_promo_name        := v_applied_promo->>'name';
    v_promo_action_type := (v_applied_promo->>'action_type')::promotion_action_type;
    v_promo_target      := v_applied_promo->>'target';
    SELECT slug, action_params INTO v_promo_slug, v_promo_action_params
      FROM promotions WHERE id = v_promo_id_local;

    FOR v_added_item IN SELECT * FROM jsonb_array_elements(v_items_to_add) LOOP
      v_split_from_existing := (v_added_item->>'split_from_existing')::BOOLEAN;
      SELECT c.dispatch_station INTO v_dispatch_station
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = (v_added_item->>'product_id')::UUID;

      IF v_split_from_existing THEN
        UPDATE order_items
          SET quantity = quantity - (v_added_item->>'qty')::DECIMAL,
              line_total = line_total - ((v_added_item->>'qty')::DECIMAL * unit_price)
          WHERE id = (
            SELECT id FROM order_items
              WHERE order_id = v_order_id
                AND product_id = (v_added_item->>'product_id')::UUID
                AND promotion_id IS NULL
              ORDER BY created_at ASC LIMIT 1
          );
      END IF;

      -- Bug #2 fix: provide name_snapshot from products
      INSERT INTO order_items (
        order_id, product_id, name_snapshot, quantity, unit_price, modifiers, line_total,
        promotion_id, promotion_discount, is_free_from_promo,
        dispatch_station, kitchen_status
      )
      SELECT
        v_order_id, p.id, p.name,
        (v_added_item->>'qty')::DECIMAL, (v_added_item->>'unit_price')::DECIMAL,
        '[]'::JSONB,
        (v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL,
        v_promo_id_local, (v_added_item->>'promotion_discount')::DECIMAL,
        (v_added_item->>'is_free_from_promo')::BOOLEAN,
        v_dispatch_station, 'pending'
      FROM products p WHERE p.id = (v_added_item->>'product_id')::UUID;
    END LOOP;

    IF v_promo_action_type = 'percentage_off' AND v_promo_target = 'product' THEN
      UPDATE order_items SET
        promotion_id = v_promo_id_local,
        promotion_discount = round_idr(line_total * (v_promo_action_params->>'percentage')::INT / 100.0)
      WHERE order_id = v_order_id
        AND product_id = (v_promo_action_params->>'target_id')::UUID
        AND discount_amount = 0
        AND promotion_id IS NULL;
    ELSIF v_promo_action_type = 'percentage_off' AND v_promo_target = 'category' THEN
      UPDATE order_items oi SET
        promotion_id = v_promo_id_local,
        promotion_discount = round_idr(oi.line_total * (v_promo_action_params->>'percentage')::INT / 100.0)
        FROM products p
        WHERE oi.order_id = v_order_id
          AND oi.product_id = p.id
          AND p.category_id = (v_promo_action_params->>'target_id')::UUID
          AND oi.discount_amount = 0
          AND oi.promotion_id IS NULL;
    END IF;

    IF v_promo_target = 'cart' THEN
      INSERT INTO order_promotions (order_id, promotion_id, target, target_order_item_id,
                                     discount_amount, free_item_added, metadata)
      VALUES (v_order_id, v_promo_id_local, 'cart', NULL, v_promo_total, false,
              jsonb_build_object(
                'name_snapshot', v_promo_name,
                'slug_snapshot', v_promo_slug,
                'action_type_snapshot', v_promo_action_type::TEXT,
                'action_params_snapshot', v_promo_action_params
              ));
    ELSE
      INSERT INTO order_promotions (order_id, promotion_id, target, target_order_item_id,
                                     discount_amount, free_item_added, metadata)
      SELECT v_order_id, v_promo_id_local, 'item', oi.id, oi.promotion_discount,
             v_promo_action_type IN ('bogo', 'free_product'),
             jsonb_build_object(
               'name_snapshot', v_promo_name,
               'slug_snapshot', v_promo_slug,
               'action_type_snapshot', v_promo_action_type::TEXT,
               'action_params_snapshot', v_promo_action_params
             )
      FROM order_items oi
      WHERE oi.order_id = v_order_id AND oi.promotion_id = v_promo_id_local;
    END IF;

    UPDATE orders SET promotion_total_amount = v_promo_total WHERE id = v_order_id;
  END IF;

  RETURN jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'table_number', p_table_number
  );
END $$;

GRANT EXECUTE ON FUNCTION create_tablet_order TO authenticated;

COMMENT ON FUNCTION create_tablet_order IS
  'Session 8 v2 (migration 9 fix): create pending_payment tablet order + freeze promotions at create-time. Bugs #1+#2 fixed: shape items for evaluate_promotions and provide name_snapshot for promo items.';

-- ============================================================
-- complete_order_with_payment v7 (replaces 20260510000005)
-- ============================================================
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
  p_evaluation_ts           TIMESTAMPTZ      DEFAULT now()
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
  v_promo_input_items    JSONB;
  v_promo_result         JSONB;
  v_applied_promo        JSONB;
  v_promo_total          DECIMAL(14,2) := 0;
  v_items_to_add         JSONB := '[]'::JSONB;
  v_added_item           JSONB;
  v_split_from_existing  BOOLEAN;
  v_promo_id_local       UUID;
  v_promo_name           TEXT;
  v_promo_action_type    promotion_action_type;
  v_promo_action_params  JSONB;
  v_promo_slug           TEXT;
  v_promo_target         TEXT;
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

  IF NOT EXISTS (
    SELECT 1 FROM pos_sessions
      WHERE id = p_session_id
        AND opened_by = v_profile_id
        AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'No open session for this user' USING ERRCODE = 'P0001';
  END IF;

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

  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  v_items_total := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(14,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_line_discount := COALESCE((v_item->>'discount_amount')::DECIMAL(14,2), 0);
    v_line_total    := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity) - v_line_discount;
    v_items_total   := v_items_total + v_line_total;
  END LOOP;

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total,
    customer_id, loyalty_points_redeemed, loyalty_redemption_amount,
    idempotency_key, paid_at, table_number,
    discount_amount, discount_type, discount_value, discount_reason, discount_authorized_by
  ) VALUES (
    v_order_number, p_session_id, v_profile_id, p_order_type, 'draft',
    0, 0, 0,
    p_customer_id, p_loyalty_points_redeemed, v_redemption_amount,
    p_idempotency_key, now(), p_table_number,
    p_discount_amount, p_discount_type, p_discount_value, p_discount_reason, p_discount_authorized_by
  ) RETURNING id INTO v_order_id;

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

    SELECT c.dispatch_station INTO v_dispatch_station
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station,
      discount_amount, discount_type, discount_value, discount_reason
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station,
      v_line_discount,
      NULLIF(v_item->>'discount_type', ''),
      CASE WHEN (v_item->>'discount_value') IS NOT NULL AND (v_item->>'discount_value') <> ''
           THEN (v_item->>'discount_value')::DECIMAL(14,2)
           ELSE NULL END,
      NULLIF(v_item->>'discount_reason', '')
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

  -- Bug #1 fix: shape p_items for evaluate_promotions (same as create_tablet_order).
  SELECT jsonb_agg(
    jsonb_build_object(
      'product_id',             item->>'product_id',
      'qty',                    (item->>'quantity')::DECIMAL,
      'unit_price',             (item->>'unit_price')::DECIMAL,
      'modifier_total',         COALESCE(
        (SELECT SUM((m->>'price_adjustment')::DECIMAL(14,2))
           FROM jsonb_array_elements(COALESCE(item->'modifiers', '[]'::jsonb)) m),
        0
      ) * (item->>'quantity')::DECIMAL,
      'manual_discount_amount', COALESCE((item->>'discount_amount')::DECIMAL(14,2), 0)
    )
  )
  INTO v_promo_input_items
  FROM jsonb_array_elements(p_items) item;

  v_promo_result := evaluate_promotions(v_promo_input_items, p_customer_id, p_evaluation_ts);
  v_applied_promo := v_promo_result->'applied_promotion';

  -- Bug #3 fix: jsonb 'null' IS NOT NULL evaluates true; check the json type instead.
  IF jsonb_typeof(v_applied_promo) = 'object' THEN
    v_promo_total       := (v_applied_promo->>'discount_amount')::DECIMAL;
    v_items_to_add      := v_applied_promo->'items_to_add';
    v_promo_id_local    := (v_applied_promo->>'promotion_id')::UUID;
    v_promo_name        := v_applied_promo->>'name';
    v_promo_action_type := (v_applied_promo->>'action_type')::promotion_action_type;
    v_promo_target      := v_applied_promo->>'target';
    SELECT slug, action_params INTO v_promo_slug, v_promo_action_params
      FROM promotions WHERE id = v_promo_id_local;

    FOR v_added_item IN SELECT * FROM jsonb_array_elements(v_items_to_add) LOOP
      v_split_from_existing := (v_added_item->>'split_from_existing')::BOOLEAN;
      SELECT c.dispatch_station INTO v_dispatch_station
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = (v_added_item->>'product_id')::UUID;

      IF v_split_from_existing THEN
        UPDATE order_items
          SET quantity = quantity - (v_added_item->>'qty')::DECIMAL,
              line_total = line_total - ((v_added_item->>'qty')::DECIMAL * unit_price)
          WHERE id = (
            SELECT id FROM order_items
              WHERE order_id = v_order_id
                AND product_id = (v_added_item->>'product_id')::UUID
                AND promotion_id IS NULL
              ORDER BY created_at ASC LIMIT 1
          );
        v_items_total := v_items_total
          - ((v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL)
          + ((v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL);
      ELSE
        v_items_total := v_items_total
          + ((v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL);
      END IF;

      -- Bug #2 fix: provide name_snapshot from products
      INSERT INTO order_items (
        order_id, product_id, name_snapshot, quantity, unit_price, modifiers, line_total,
        promotion_id, promotion_discount, is_free_from_promo,
        dispatch_station, kitchen_status
      )
      SELECT
        v_order_id, p.id, p.name,
        (v_added_item->>'qty')::DECIMAL, (v_added_item->>'unit_price')::DECIMAL,
        '[]'::JSONB,
        (v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL,
        v_promo_id_local, (v_added_item->>'promotion_discount')::DECIMAL,
        (v_added_item->>'is_free_from_promo')::BOOLEAN,
        v_dispatch_station, 'pending'
      FROM products p WHERE p.id = (v_added_item->>'product_id')::UUID;
    END LOOP;

    IF v_promo_action_type = 'percentage_off' AND v_promo_target = 'product' THEN
      UPDATE order_items SET
        promotion_id = v_promo_id_local,
        promotion_discount = round_idr(line_total * (v_promo_action_params->>'percentage')::INT / 100.0)
      WHERE order_id = v_order_id
        AND product_id = (v_promo_action_params->>'target_id')::UUID
        AND discount_amount = 0
        AND promotion_id IS NULL;
    ELSIF v_promo_action_type = 'percentage_off' AND v_promo_target = 'category' THEN
      UPDATE order_items oi SET
        promotion_id = v_promo_id_local,
        promotion_discount = round_idr(oi.line_total * (v_promo_action_params->>'percentage')::INT / 100.0)
        FROM products p
        WHERE oi.order_id = v_order_id
          AND oi.product_id = p.id
          AND p.category_id = (v_promo_action_params->>'target_id')::UUID
          AND oi.discount_amount = 0
          AND oi.promotion_id IS NULL;
    END IF;

    IF v_promo_target = 'cart' THEN
      INSERT INTO order_promotions (order_id, promotion_id, target, target_order_item_id,
                                     discount_amount, free_item_added, metadata)
      VALUES (v_order_id, v_promo_id_local, 'cart', NULL, v_promo_total, false,
              jsonb_build_object(
                'name_snapshot', v_promo_name,
                'slug_snapshot', v_promo_slug,
                'action_type_snapshot', v_promo_action_type::TEXT,
                'action_params_snapshot', v_promo_action_params
              ));
    ELSE
      INSERT INTO order_promotions (order_id, promotion_id, target, target_order_item_id,
                                     discount_amount, free_item_added, metadata)
      SELECT v_order_id, v_promo_id_local, 'item', oi.id, oi.promotion_discount,
             v_promo_action_type IN ('bogo', 'free_product'),
             jsonb_build_object(
               'name_snapshot', v_promo_name,
               'slug_snapshot', v_promo_slug,
               'action_type_snapshot', v_promo_action_type::TEXT,
               'action_params_snapshot', v_promo_action_params
             )
      FROM order_items oi
      WHERE oi.order_id = v_order_id AND oi.promotion_id = v_promo_id_local;
    END IF;
  END IF;

  v_total := v_items_total - v_promo_total - v_redemption_amount - p_discount_amount;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts exceed items total' USING ERRCODE = 'check_violation';
  END IF;
  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));

  UPDATE orders SET
    status                 = 'paid',
    paid_at                = now(),
    subtotal               = v_items_total,
    tax_amount             = v_tax_amount,
    total                  = v_total,
    promotion_total_amount = v_promo_total
  WHERE id = v_order_id;

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

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.complete', 'orders', v_order_id, jsonb_build_object(
      'order_number',    v_order_number,
      'items_total',     v_items_total,
      'total',           v_total,
      'promo_total',     v_promo_total,
      'redemption',      v_redemption_amount,
      'discount_amount', p_discount_amount,
      'payment_method',  p_payment->>'method',
      'table_number',    p_table_number
    ));

  RETURN jsonb_build_object(
    'order_id',                  v_order_id,
    'order_number',              v_order_number,
    'subtotal',                  v_items_total,
    'tax_amount',                v_tax_amount,
    'total',                     v_total,
    'promotion_total_amount',    v_promo_total,
    'discount_amount',           p_discount_amount,
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
  'RPC central transactionnel (session 8) v7: bugs #1+#2 fixed (item shape for evaluate_promotions, name_snapshot for promo items). Stack: items_total - promo - redemption - discount = total.';
