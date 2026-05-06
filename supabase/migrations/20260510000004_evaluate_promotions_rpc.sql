-- 20260510000004_evaluate_promotions_rpc.sql
-- Session 8 / migration 4 : engine RPC qui evalue toutes les promos actives
-- contre p_items, p_customer_id, p_evaluation_ts et retourne best-only.
-- Spec: §3.8, conditions §3.4, action_params §3.3.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'evaluate_promotions' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION evaluate_promotions(
  p_items          JSONB,
  p_customer_id    UUID DEFAULT NULL,
  p_evaluation_ts  TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_promo                 RECORD;
  v_condition             JSONB;
  v_eligible              BOOLEAN;
  v_skip_reason           TEXT;
  v_potential_discount    DECIMAL(14,2);
  v_subtotal              DECIMAL(14,2);
  v_matching_qty          INTEGER;
  v_matching_subtotal     DECIMAL(14,2);
  v_customer_category_id  UUID;
  v_customer_tier         TEXT;
  v_customer_first_order  BOOLEAN;
  v_local_time            TIME;
  v_local_dow             INTEGER;
  v_local_date            DATE;
  v_pairs                 INTEGER;
  v_buy_product_id        UUID;
  v_buy_qty               INTEGER;
  v_get_qty               INTEGER;
  v_get_discount_pct      INTEGER;
  v_get_discount_per_unit DECIMAL(14,2);
  v_target                TEXT;
  v_target_id             UUID;
  v_percentage            INTEGER;
  v_amount                DECIMAL(14,2);
  v_free_product_id       UUID;
  v_free_qty              INTEGER;
  v_buy_unit_price        DECIMAL(14,2);
  v_free_unit_price       DECIMAL(14,2);
  v_best_promo_id         UUID;
  v_best_promo_name       TEXT;
  v_best_action_type      promotion_action_type;
  v_best_target           TEXT;
  v_best_target_pid       UUID;
  v_best_discount         DECIMAL(14,2) := 0;
  v_best_items_to_add     JSONB := '[]'::JSONB;
  v_skipped               JSONB := '[]'::JSONB;
  v_item                  JSONB;
BEGIN
  -- Resolve customer category, tier, first_order
  IF p_customer_id IS NOT NULL THEN
    SELECT c.category_id INTO v_customer_category_id
      FROM customers c WHERE c.id = p_customer_id;
    IF v_customer_category_id IS NULL THEN
      SELECT id INTO v_customer_category_id FROM customer_categories
        WHERE is_default = true AND deleted_at IS NULL;
    END IF;
    SELECT
      CASE
        WHEN COALESCE(c.lifetime_points, 0) >= 5000 THEN 'Platinum'
        WHEN COALESCE(c.lifetime_points, 0) >= 2000 THEN 'Gold'
        WHEN COALESCE(c.lifetime_points, 0) >= 500  THEN 'Silver'
        ELSE 'Bronze'
      END,
      COALESCE(c.lifetime_orders, 0) = 0
      INTO v_customer_tier, v_customer_first_order
      FROM customers c WHERE c.id = p_customer_id;
  ELSE
    SELECT id INTO v_customer_category_id FROM customer_categories
      WHERE is_default = true AND deleted_at IS NULL;
    v_customer_tier := 'Bronze';
    v_customer_first_order := false;
  END IF;

  -- Time fields in Asia/Jakarta
  v_local_time := (p_evaluation_ts AT TIME ZONE 'Asia/Jakarta')::time;
  v_local_dow  := EXTRACT(dow FROM (p_evaluation_ts AT TIME ZONE 'Asia/Jakarta'))::int;
  v_local_date := (p_evaluation_ts AT TIME ZONE 'Asia/Jakarta')::date;

  -- Compute cart subtotal (post manual line discount)
  v_subtotal := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_subtotal := v_subtotal +
      ((v_item->>'qty')::DECIMAL *
       ((v_item->>'unit_price')::DECIMAL + COALESCE((v_item->>'modifier_total')::DECIMAL, 0))) -
      COALESCE((v_item->>'manual_discount_amount')::DECIMAL, 0);
  END LOOP;

  -- Iterate active promotions ordered by priority DESC, created_at ASC
  FOR v_promo IN
    SELECT id, name, slug, action_type, action_params, conditions, priority, created_at
    FROM promotions
    WHERE deleted_at IS NULL AND is_active
    ORDER BY priority DESC, created_at ASC
  LOOP
    v_eligible := true;
    v_skip_reason := NULL;

    -- Evaluate ALL conditions (AND-logic)
    FOR v_condition IN SELECT * FROM jsonb_array_elements(v_promo.conditions->'all') LOOP
      CASE v_condition->>'type'
        WHEN 'cart_total_min' THEN
          IF v_subtotal < (v_condition->>'value')::DECIMAL THEN
            v_eligible := false; v_skip_reason := 'condition_failed:cart_total_min';
          END IF;
        WHEN 'product_in_cart' THEN
          SELECT COALESCE(SUM((i->>'qty')::INT), 0) INTO v_matching_qty
            FROM jsonb_array_elements(p_items) i
            WHERE (i->>'product_id')::UUID = (v_condition->>'product_id')::UUID;
          IF v_matching_qty < (v_condition->>'min_qty')::INT THEN
            v_eligible := false; v_skip_reason := 'condition_failed:product_in_cart';
          END IF;
        WHEN 'category_in_cart' THEN
          SELECT COALESCE(SUM((i->>'qty')::INT), 0) INTO v_matching_qty
            FROM jsonb_array_elements(p_items) i
            JOIN products p ON p.id = (i->>'product_id')::UUID
            WHERE p.category_id = (v_condition->>'category_id')::UUID;
          IF v_matching_qty < (v_condition->>'min_qty')::INT THEN
            v_eligible := false; v_skip_reason := 'condition_failed:category_in_cart';
          END IF;
        WHEN 'customer_category_in' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_condition->'category_ids') t
            WHERE t::UUID = v_customer_category_id
          ) THEN
            v_eligible := false; v_skip_reason := 'condition_failed:customer_category_in';
          END IF;
        WHEN 'time_window' THEN
          IF v_local_time < (v_condition->>'start')::time
             OR v_local_time > (v_condition->>'end')::time THEN
            v_eligible := false; v_skip_reason := 'condition_failed:time_window';
          END IF;
        WHEN 'weekday_in' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_condition->'days') t
            WHERE t::INT = v_local_dow
          ) THEN
            v_eligible := false; v_skip_reason := 'condition_failed:weekday_in';
          END IF;
        WHEN 'valid_dates' THEN
          IF v_local_date < (v_condition->>'from')::date
             OR v_local_date > (v_condition->>'until')::date THEN
            v_eligible := false; v_skip_reason := 'condition_failed:valid_dates';
          END IF;
        WHEN 'customer_in_loyalty_tier' THEN
          IF NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(v_condition->'tiers') t
            WHERE t = v_customer_tier
          ) THEN
            v_eligible := false; v_skip_reason := 'condition_failed:customer_in_loyalty_tier';
          END IF;
        WHEN 'first_order_only' THEN
          IF NOT v_customer_first_order THEN
            v_eligible := false; v_skip_reason := 'condition_failed:first_order_only';
          END IF;
      END CASE;
      EXIT WHEN NOT v_eligible;
    END LOOP;

    IF NOT v_eligible THEN
      v_skipped := v_skipped || jsonb_build_object('promotion_id', v_promo.id, 'reason', v_skip_reason);
      CONTINUE;
    END IF;

    -- P12: skip auto promo if any targeted item has manual_discount_amount > 0
    v_target := v_promo.action_params->>'target';
    v_target_id := NULLIF(v_promo.action_params->>'target_id', '')::UUID;

    IF v_promo.action_type = 'percentage_off' AND v_target = 'product' THEN
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        WHERE (i->>'product_id')::UUID = v_target_id
          AND COALESCE((i->>'manual_discount_amount')::DECIMAL, 0) > 0
      ) THEN
        v_skipped := v_skipped || jsonb_build_object(
          'promotion_id', v_promo.id, 'reason', 'manual_discount_present');
        CONTINUE;
      END IF;
    ELSIF v_promo.action_type = 'percentage_off' AND v_target = 'category' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        JOIN products p ON p.id = (i->>'product_id')::UUID
        WHERE p.category_id = v_target_id
          AND COALESCE((i->>'manual_discount_amount')::DECIMAL, 0) = 0
      ) THEN
        v_skipped := v_skipped || jsonb_build_object(
          'promotion_id', v_promo.id, 'reason', 'manual_discount_present');
        CONTINUE;
      END IF;
    ELSIF v_promo.action_type = 'bogo' THEN
      v_buy_product_id := (v_promo.action_params->>'buy_product_id')::UUID;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_items) i
        WHERE (i->>'product_id')::UUID = v_buy_product_id
          AND COALESCE((i->>'manual_discount_amount')::DECIMAL, 0) > 0
      ) THEN
        v_skipped := v_skipped || jsonb_build_object(
          'promotion_id', v_promo.id, 'reason', 'manual_discount_present');
        CONTINUE;
      END IF;
    END IF;

    -- Compute potential discount per action_type
    v_potential_discount := 0;
    v_target_id := NULLIF(v_promo.action_params->>'target_id', '')::UUID;

    IF v_promo.action_type = 'percentage_off' THEN
      v_percentage := (v_promo.action_params->>'percentage')::INT;
      IF v_target = 'cart' THEN
        v_potential_discount := round_idr(v_subtotal * v_percentage / 100.0);
      ELSIF v_target = 'category' THEN
        SELECT COALESCE(SUM(
          ((i->>'qty')::DECIMAL *
           ((i->>'unit_price')::DECIMAL + COALESCE((i->>'modifier_total')::DECIMAL, 0))) -
          COALESCE((i->>'manual_discount_amount')::DECIMAL, 0)
        ), 0) INTO v_matching_subtotal
          FROM jsonb_array_elements(p_items) i
          JOIN products p ON p.id = (i->>'product_id')::UUID
          WHERE p.category_id = v_target_id;
        v_potential_discount := round_idr(v_matching_subtotal * v_percentage / 100.0);
      ELSIF v_target = 'product' THEN
        SELECT COALESCE(SUM(
          ((i->>'qty')::DECIMAL *
           ((i->>'unit_price')::DECIMAL + COALESCE((i->>'modifier_total')::DECIMAL, 0))) -
          COALESCE((i->>'manual_discount_amount')::DECIMAL, 0)
        ), 0) INTO v_matching_subtotal
          FROM jsonb_array_elements(p_items) i
          WHERE (i->>'product_id')::UUID = v_target_id;
        v_potential_discount := round_idr(v_matching_subtotal * v_percentage / 100.0);
      END IF;

    ELSIF v_promo.action_type = 'fixed_off' THEN
      v_amount := (v_promo.action_params->>'amount')::DECIMAL;
      v_potential_discount := LEAST(v_amount, v_subtotal);

    ELSIF v_promo.action_type = 'bogo' THEN
      v_buy_product_id := (v_promo.action_params->>'buy_product_id')::UUID;
      v_buy_qty := (v_promo.action_params->>'buy_qty')::INT;
      v_get_qty := (v_promo.action_params->>'get_qty')::INT;
      v_get_discount_pct := (v_promo.action_params->>'get_discount_pct')::INT;
      SELECT COALESCE(SUM((i->>'qty')::INT), 0) INTO v_matching_qty
        FROM jsonb_array_elements(p_items) i
        WHERE (i->>'product_id')::UUID = v_buy_product_id;
      v_pairs := v_matching_qty / (v_buy_qty + v_get_qty);
      SELECT retail_price INTO v_buy_unit_price FROM products WHERE id = v_buy_product_id;
      v_get_discount_per_unit := round_idr(v_buy_unit_price * v_get_discount_pct / 100.0);
      v_potential_discount := v_pairs * v_get_qty * v_get_discount_per_unit;

    ELSIF v_promo.action_type = 'free_product' THEN
      v_free_product_id := (v_promo.action_params->>'product_id')::UUID;
      v_free_qty := (v_promo.action_params->>'qty')::INT;
      SELECT retail_price INTO v_free_unit_price FROM products WHERE id = v_free_product_id;
      v_potential_discount := v_free_unit_price * v_free_qty;
    END IF;

    -- Track best (max discount, ties broken by priority DESC then created_at ASC, already sorted)
    IF v_potential_discount > v_best_discount THEN
      v_best_discount := v_potential_discount;
      v_best_promo_id := v_promo.id;
      v_best_promo_name := v_promo.name;
      v_best_action_type := v_promo.action_type;
      v_best_target := v_target;
      v_best_target_pid := CASE
        WHEN v_promo.action_type = 'percentage_off' AND v_target IN ('product') THEN v_target_id
        WHEN v_promo.action_type = 'bogo' THEN v_buy_product_id
        WHEN v_promo.action_type = 'free_product' THEN v_free_product_id
        ELSE NULL
      END;

      -- Build items_to_add for bogo / free_product
      IF v_promo.action_type = 'bogo' THEN
        v_best_items_to_add := jsonb_build_array(jsonb_build_object(
          'product_id', v_buy_product_id,
          'qty', v_pairs * v_get_qty,
          'unit_price', v_buy_unit_price,
          'promotion_discount', v_get_discount_per_unit,
          'is_free_from_promo', (v_get_discount_pct = 100),
          'split_from_existing', true
        ));
      ELSIF v_promo.action_type = 'free_product' THEN
        v_best_items_to_add := jsonb_build_array(jsonb_build_object(
          'product_id', v_free_product_id,
          'qty', v_free_qty,
          'unit_price', v_free_unit_price,
          'promotion_discount', v_free_unit_price,
          'is_free_from_promo', true,
          'split_from_existing', false
        ));
      ELSE
        v_best_items_to_add := '[]'::JSONB;
      END IF;
    ELSE
      v_skipped := v_skipped || jsonb_build_object(
        'promotion_id', v_promo.id, 'reason', 'not_best');
    END IF;
  END LOOP;

  -- Return best-only result
  IF v_best_promo_id IS NULL THEN
    RETURN jsonb_build_object(
      'applied_promotion', NULL,
      'skipped_promotions', v_skipped
    );
  END IF;

  RETURN jsonb_build_object(
    'applied_promotion', jsonb_build_object(
      'promotion_id', v_best_promo_id,
      'name', v_best_promo_name,
      'action_type', v_best_action_type,
      'target', COALESCE(v_best_target, 'cart'),
      'target_product_id', v_best_target_pid,
      'discount_amount', v_best_discount,
      'items_to_add', v_best_items_to_add
    ),
    'skipped_promotions', v_skipped
  );
END $$;

GRANT EXECUTE ON FUNCTION evaluate_promotions TO authenticated;

COMMENT ON FUNCTION evaluate_promotions IS
  'Session 8: evaluates all active promotions against cart items, customer, and timestamp. Returns best-only result with items_to_add for BOGO/free_product. 4 action_types, 9 condition_types, best-only selection.';
