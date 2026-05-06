-- 20260510000007_extend_create_tablet_order_rpc.sql
-- Session 8 / migration 7 : create_tablet_order évalue + freeze les promos au create-time.
-- pay_existing_order v3 lira ces valeurs au pickup sans re-eval.
-- Spec: §3.11.

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
  -- Promo vars
  v_promo_result          JSONB;
  v_applied_promo         JSONB;
  v_promo_total           DECIMAL(14,2) := 0;
  v_items_to_add          JSONB := '[]'::JSONB;
  v_added_item            JSONB;
  v_split_from_existing   BOOLEAN;
  v_promo_id_local        UUID;
  v_promo_name            TEXT;
  v_promo_action_type     promotion_action_type;
  v_promo_action_params   JSONB;
  v_promo_slug            TEXT;
  v_promo_target          TEXT;
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

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order_id FROM orders WHERE idempotency_key = p_idempotency_key;
    IF v_order_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'order_id', v_order_id,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- Resolve waiter profile from session
  SELECT opened_by INTO v_waiter_id FROM pos_sessions WHERE id = p_session_id;

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
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

    SELECT c.dispatch_station
      INTO v_dispatch_station
      FROM products p
      JOIN categories c ON c.id = p.category_id
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

  -- Evaluate + freeze promotions at create-time (P10)
  v_promo_result := evaluate_promotions(p_items, p_customer_id, p_evaluation_ts);
  v_applied_promo := v_promo_result->'applied_promotion';

  IF v_applied_promo IS NOT NULL THEN
    v_promo_total           := (v_applied_promo->>'discount_amount')::DECIMAL;
    v_items_to_add          := v_applied_promo->'items_to_add';
    v_promo_id_local        := (v_applied_promo->>'promotion_id')::UUID;
    v_promo_name            := v_applied_promo->>'name';
    v_promo_action_type     := (v_applied_promo->>'action_type')::promotion_action_type;
    v_promo_target          := v_applied_promo->>'target';
    SELECT slug, action_params INTO v_promo_slug, v_promo_action_params
      FROM promotions WHERE id = v_promo_id_local;

    -- Apply: split (BOGO) / append (free_product) / mark (percentage_off)
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

      INSERT INTO order_items (
        order_id, product_id, quantity, unit_price, modifiers, line_total,
        promotion_id, promotion_discount, is_free_from_promo,
        dispatch_station, kitchen_status
      ) VALUES (
        v_order_id, (v_added_item->>'product_id')::UUID,
        (v_added_item->>'qty')::DECIMAL, (v_added_item->>'unit_price')::DECIMAL,
        '[]'::JSONB,
        (v_added_item->>'qty')::DECIMAL * (v_added_item->>'unit_price')::DECIMAL,
        v_promo_id_local, (v_added_item->>'promotion_discount')::DECIMAL,
        (v_added_item->>'is_free_from_promo')::BOOLEAN,
        v_dispatch_station, 'pending'
      );
    END LOOP;

    -- percentage_off target=product/category : marquer les lignes existantes (skip si manual)
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

    -- INSERT order_promotions audit (1 row si target=cart, N rows si target=item)
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

    -- Freeze promo total on order
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
  'Session 8: creates pending_payment tablet order + evaluates and freezes promotions at create-time (P10). pay_existing_order v3 reads frozen promo without re-evaluation.';
