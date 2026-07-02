-- 20260710000091_evaluate_promotions_v2_usage_caps.sql
-- S57 P2.1 (Chantier A, A-D4/A-D5/A-D6/A-D7) — evaluate_promotions_v1 -> v2.
-- Body copied verbatim from v1 (_082/20260517000082) with exactly one addition:
-- an advisory usage-cap check inserted among the per-promo matchers (3.a), right
-- after the customer-tier matcher and before the stacking decision (3.b) — a
-- capped-out promo is treated exactly like an ineligible promo for anchor
-- selection purposes. This function is advisory only (POS calls it upfront to
-- price the cart) ; the atomic hard gate lives in
-- complete_order_with_payment_v17 (_092) at the promotion_applications INSERT.
--
-- Cap semantics (A-D4/A-D6/A-D7):
--   - max_uses (global)         : COUNT(promotion_applications) JOIN orders
--                                  WHERE voided_at IS NULL >= max_uses -> skip.
--   - max_uses_per_customer     : same count scoped to p_customer_id ; SKIPPED
--                                  entirely when p_customer_id IS NULL (an
--                                  anonymous order cannot be attributed a
--                                  per-customer usage — the global cap still
--                                  applies unconditionally).
--   - NULL cap column           : illimité (no check).
--
-- DROP v1 in the same migration (RPC versioning rule). All callers referencing
-- `evaluate_promotions_v1` by name are repointed to v2 in this same commit set:
--   - pay_existing_order_v11 (in-place CREATE OR REPLACE below — signature
--     unchanged, precedent: _078/_081 in-place internal-dependency fixes).
--   - complete_order_with_payment_v17 (_092, next migration).
--   - apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts (app code).
--   - supabase/tests/promotions_bogo.test.sql,
--     supabase/tests/functions/promotions-evaluate-v1.test.ts (test suites).

CREATE OR REPLACE FUNCTION public.evaluate_promotions_v2(
  p_cart_items JSONB,
  p_customer_id UUID DEFAULT NULL,
  p_subtotal NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now            TIMESTAMPTZ := now();
  v_subtotal       NUMERIC     := 0;
  v_quantity       NUMERIC     := 0;
  v_customer_cat   UUID;
  v_customer_tier  UUID;
  v_promo          RECORD;
  v_applied        JSONB       := '[]'::jsonb;
  v_anchor_stacks  BOOLEAN     := NULL;
  v_dow_bit        INT;
  v_hour           INT;
  v_trigger_count  INT;
  v_applications   INT;
  v_get_unit_price NUMERIC;
  v_match_subtotal NUMERIC;
  v_match_complete BOOLEAN;
  v_amount         NUMERIC;
  v_total_disc     NUMERIC     := 0;
  v_free_items     JSONB;
  -- S57 A-D4/A-D5: advisory usage-cap counters.
  v_uses_global    INT;
  v_uses_customer  INT;
BEGIN
  ----------------------------------------------------------------------
  -- 1. Compute cart aggregates : subtotal + quantity from p_cart_items.
  ----------------------------------------------------------------------
  IF p_cart_items IS NULL OR jsonb_array_length(p_cart_items) = 0 THEN
    RETURN jsonb_build_object(
      'applied_promotions',       '[]'::jsonb,
      'subtotal_before',          COALESCE(p_subtotal, 0),
      'subtotal_after_discount',  COALESCE(p_subtotal, 0),
      'total_discount',           0
    );
  END IF;

  SELECT
    COALESCE(SUM((item ->> 'unit_price')::NUMERIC * (item ->> 'quantity')::NUMERIC), 0),
    COALESCE(SUM((item ->> 'quantity')::NUMERIC), 0)
  INTO v_subtotal, v_quantity
  FROM jsonb_array_elements(p_cart_items) AS item
  WHERE COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false;

  -- Caller-provided subtotal overrides computed one when supplied (e.g.
  -- caller has already applied loyalty redemption / cart-level discount).
  IF p_subtotal IS NOT NULL THEN
    v_subtotal := p_subtotal;
  END IF;

  v_dow_bit := ((EXTRACT(ISODOW FROM v_now)::INT - 1) % 7); -- 0=Mon..6=Sun
  v_hour    := EXTRACT(HOUR FROM v_now)::INT;

  ----------------------------------------------------------------------
  -- 2. Customer category + tier lookup (one query, cheap).
  ----------------------------------------------------------------------
  IF p_customer_id IS NOT NULL THEN
    SELECT category_id, tier_id
    INTO   v_customer_cat, v_customer_tier
    FROM   customers
    WHERE  id = p_customer_id;
  END IF;

  ----------------------------------------------------------------------
  -- 3. Iterate every eligible promotion by priority desc, created_at desc.
  --    For each, apply matchers + per-type computation + stacking.
  ----------------------------------------------------------------------
  FOR v_promo IN
    SELECT *
    FROM   promotions
    WHERE  is_active = true
      AND  deleted_at IS NULL
    ORDER BY priority DESC, created_at DESC
  LOOP
    -- 3.a Matchers : date / dow / hour / min_items_total / customer.
    IF v_promo.start_at IS NOT NULL AND v_now < v_promo.start_at THEN CONTINUE; END IF;
    IF v_promo.end_at   IS NOT NULL AND v_now > v_promo.end_at   THEN CONTINUE; END IF;
    IF v_promo.day_of_week_mask <= 0
       OR (v_promo.day_of_week_mask & (1 << v_dow_bit)) = 0 THEN
      CONTINUE;
    END IF;
    IF v_promo.start_hour IS NOT NULL AND v_promo.end_hour IS NOT NULL THEN
      IF v_hour < v_promo.start_hour OR v_hour >= v_promo.end_hour THEN CONTINUE; END IF;
    ELSIF (v_promo.start_hour IS NULL) <> (v_promo.end_hour IS NULL) THEN
      CONTINUE; -- mismatched hour bounds : skip
    END IF;
    IF v_promo.min_items_total > 0 AND v_subtotal < v_promo.min_items_total THEN CONTINUE; END IF;
    IF array_length(v_promo.customer_category_ids, 1) IS NOT NULL THEN
      IF v_customer_cat IS NULL
         OR NOT (v_customer_cat = ANY(v_promo.customer_category_ids)) THEN
        CONTINUE;
      END IF;
    END IF;
    IF array_length(v_promo.customer_tier_ids, 1) IS NOT NULL THEN
      IF v_customer_tier IS NULL
         OR NOT (v_customer_tier = ANY(v_promo.customer_tier_ids)) THEN
        CONTINUE;
      END IF;
    END IF;

    -- 3.a' Usage caps (S57 A-D4/A-D5/A-D6/A-D7) : a promo that has already hit
    -- its cap is not eligible — advisory here, hard-gated atomically in v17.
    IF v_promo.max_uses IS NOT NULL THEN
      SELECT count(*) INTO v_uses_global
        FROM promotion_applications pa
        JOIN orders o ON o.id = pa.order_id
        WHERE pa.promotion_id = v_promo.id AND o.voided_at IS NULL;
      IF v_uses_global >= v_promo.max_uses THEN CONTINUE; END IF;
    END IF;
    IF v_promo.max_uses_per_customer IS NOT NULL AND p_customer_id IS NOT NULL THEN
      SELECT count(*) INTO v_uses_customer
        FROM promotion_applications pa
        JOIN orders o ON o.id = pa.order_id
        WHERE pa.promotion_id = v_promo.id
          AND o.customer_id = p_customer_id
          AND o.voided_at IS NULL;
      IF v_uses_customer >= v_promo.max_uses_per_customer THEN CONTINUE; END IF;
    END IF;

    -- 3.b Stacking : drop if anchor is non-stackable.
    IF v_anchor_stacks IS NOT NULL
       AND (v_anchor_stacks = false OR v_promo.stackable_with_promo = false) THEN
      CONTINUE;
    END IF;

    v_amount     := NULL;
    v_free_items := '[]'::jsonb;

    -- 3.c Per-type computation.
    IF v_promo.type IN ('percentage', 'fixed_amount') THEN
      -- Eligible base by scope.
      IF v_promo.scope = 'cart' THEN
        v_match_subtotal := v_subtotal;
      ELSIF v_promo.scope = 'product' THEN
        SELECT COALESCE(SUM((item ->> 'unit_price')::NUMERIC * (item ->> 'quantity')::NUMERIC), 0)
        INTO   v_match_subtotal
        FROM   jsonb_array_elements(p_cart_items) AS item
        WHERE  (item ->> 'product_id')::UUID = ANY(v_promo.scope_product_ids)
          AND  COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false;
      ELSIF v_promo.scope = 'category' THEN
        SELECT COALESCE(SUM((item ->> 'unit_price')::NUMERIC * (item ->> 'quantity')::NUMERIC), 0)
        INTO   v_match_subtotal
        FROM   jsonb_array_elements(p_cart_items) AS item
        JOIN   products p ON p.id = (item ->> 'product_id')::UUID
        WHERE  p.category_id = ANY(v_promo.scope_category_ids)
          AND  COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false;
      ELSE
        v_match_subtotal := 0;
      END IF;

      IF v_match_subtotal <= 0 THEN CONTINUE; END IF;

      IF v_promo.type = 'percentage' THEN
        v_amount := ROUND(v_match_subtotal * v_promo.discount_value / 100);
        IF v_promo.max_discount_amount IS NOT NULL THEN
          v_amount := LEAST(v_amount, v_promo.max_discount_amount);
        END IF;
      ELSE -- fixed_amount
        v_amount := v_promo.discount_value;
      END IF;
      v_amount := LEAST(v_amount, v_match_subtotal);

    ELSIF v_promo.type = 'bogo' AND v_promo.bogo_buy_quantity IS NOT NULL
                                AND v_promo.bogo_get_quantity IS NOT NULL
                                AND v_promo.bogo_get_product_id IS NOT NULL THEN
      -- New BOGO shape : buy N (any trigger or restricted) get M of single SKU.
      IF array_length(v_promo.bogo_trigger_product_ids, 1) IS NOT NULL THEN
        SELECT COALESCE(SUM((item ->> 'quantity')::NUMERIC), 0)::INT
        INTO   v_trigger_count
        FROM   jsonb_array_elements(p_cart_items) AS item
        WHERE  (item ->> 'product_id')::UUID = ANY(v_promo.bogo_trigger_product_ids)
          AND  COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false;
      ELSE
        SELECT COALESCE(SUM((item ->> 'quantity')::NUMERIC), 0)::INT
        INTO   v_trigger_count
        FROM   jsonb_array_elements(p_cart_items) AS item
        WHERE  COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false;
      END IF;

      v_applications := FLOOR(v_trigger_count::NUMERIC / v_promo.bogo_buy_quantity)::INT;
      IF v_applications <= 0 THEN CONTINUE; END IF;

      SELECT retail_price INTO v_get_unit_price
      FROM   products WHERE id = v_promo.bogo_get_product_id;
      IF v_get_unit_price IS NULL THEN v_get_unit_price := 0; END IF;

      v_amount := ROUND(v_applications * v_promo.bogo_get_quantity * v_get_unit_price);
      v_free_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_promo.bogo_get_product_id,
        'quantity',   v_applications * v_promo.bogo_get_quantity
      ));

    ELSIF v_promo.type = 'bogo' THEN
      -- Legacy BOGO array shape (Session 9 parity).
      DECLARE
        v_trig    NUMERIC := 0;
        v_rew     NUMERIC := 0;
        v_rew_sum NUMERIC := 0;
        v_apps    INT;
      BEGIN
        SELECT COALESCE(SUM((item ->> 'quantity')::NUMERIC), 0)
        INTO   v_trig
        FROM   jsonb_array_elements(p_cart_items) AS item
        WHERE  (item ->> 'product_id')::UUID = ANY(v_promo.bogo_trigger_product_ids)
          AND  COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false;

        SELECT
          COALESCE(SUM((item ->> 'quantity')::NUMERIC), 0),
          COALESCE(SUM(COALESCE(p.retail_price, (item ->> 'unit_price')::NUMERIC)
                       * (item ->> 'quantity')::NUMERIC), 0)
        INTO v_rew, v_rew_sum
        FROM jsonb_array_elements(p_cart_items) AS item
        LEFT JOIN products p ON p.id = (item ->> 'product_id')::UUID
        WHERE (item ->> 'product_id')::UUID = ANY(v_promo.bogo_reward_product_ids)
          AND COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false;

        IF v_trig = 0 OR v_rew = 0 THEN CONTINUE; END IF;
        v_apps := LEAST(FLOOR(v_trig / v_promo.bogo_trigger_qty),
                        FLOOR(v_rew  / v_promo.bogo_reward_qty))::INT;
        IF v_apps <= 0 THEN CONTINUE; END IF;
        v_amount := ROUND(v_apps * v_promo.bogo_reward_qty
                          * (v_rew_sum / v_rew)
                          * v_promo.bogo_reward_discount_pct / 100);
      END;

    ELSIF v_promo.type = 'threshold' THEN
      IF v_promo.threshold_type = 'subtotal' THEN
        v_match_complete := v_subtotal >= v_promo.threshold_amount;
      ELSE -- quantity
        v_match_complete := v_quantity >= v_promo.threshold_amount;
      END IF;
      IF NOT v_match_complete THEN CONTINUE; END IF;

      IF v_promo.max_discount_amount IS NOT NULL THEN
        -- Percent semantics (cap signals percent).
        v_amount := ROUND(v_subtotal * v_promo.discount_value / 100);
        v_amount := LEAST(v_amount, v_promo.max_discount_amount);
      ELSE
        -- Fixed semantics.
        v_amount := v_promo.discount_value;
      END IF;
      v_amount := LEAST(v_amount, v_subtotal);

    ELSIF v_promo.type = 'bundle' THEN
      -- All bundle product ids must be present (qty >= 1).
      v_match_complete := true;
      v_match_subtotal := 0;
      DECLARE
        v_pid UUID;
        v_min_price NUMERIC;
      BEGIN
        FOREACH v_pid IN ARRAY v_promo.bundle_product_ids LOOP
          SELECT MIN((item ->> 'unit_price')::NUMERIC)
          INTO   v_min_price
          FROM   jsonb_array_elements(p_cart_items) AS item
          WHERE  (item ->> 'product_id')::UUID = v_pid
            AND  COALESCE((item ->> 'is_promo_gift')::BOOLEAN, false) = false
            AND  (item ->> 'quantity')::NUMERIC >= 1;
          IF v_min_price IS NULL THEN
            v_match_complete := false;
            EXIT;
          END IF;
          v_match_subtotal := v_match_subtotal + v_min_price;
        END LOOP;
      END;
      IF NOT v_match_complete THEN CONTINUE; END IF;
      v_amount := v_match_subtotal - v_promo.bundle_price;

    ELSIF v_promo.type = 'free_product' THEN
      v_amount := 0;
      v_free_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_promo.gift_product_id,
        'quantity',   v_promo.gift_qty
      ));
    ELSE
      CONTINUE;
    END IF;

    -- 3.d Drop zero-discount applications (except free_product gifts).
    IF v_amount IS NULL OR (v_amount <= 0 AND v_promo.type <> 'free_product') THEN
      CONTINUE;
    END IF;

    -- 3.e Round half-up + accumulate.
    v_amount := ROUND(v_amount);
    v_total_disc := v_total_disc + v_amount;

    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'promotion_id',    v_promo.id,
      'slug',            v_promo.slug,
      'name',            v_promo.name,
      'type',            v_promo.type::TEXT,
      'discount_amount', v_amount,
      'description',     v_promo.name,
      'free_items',      v_free_items
    ));

    -- 3.f Anchor stacking decision : first applied sets the gate.
    IF v_anchor_stacks IS NULL THEN
      v_anchor_stacks := v_promo.stackable_with_promo;
    END IF;
  END LOOP;

  ----------------------------------------------------------------------
  -- 4. Build return payload. `subtotal_after_discount` may go negative
  --    only if a misconfigured fixed_amount slipped past LEAST(); we
  --    clamp at 0 for safety.
  ----------------------------------------------------------------------
  RETURN jsonb_build_object(
    'applied_promotions',      v_applied,
    'subtotal_before',         v_subtotal,
    'subtotal_after_discount', GREATEST(v_subtotal - v_total_disc, 0),
    'total_discount',          v_total_disc
  );
END;
$$;

COMMENT ON FUNCTION public.evaluate_promotions_v2(JSONB, UUID, NUMERIC) IS
  'S57 A-D5 — server-side promotion evaluator, v1 + advisory usage-cap check '
  '(max_uses/max_uses_per_customer). Mirrors packages/domain/src/promotions/bogoEngine.ts '
  '(caps are NOT mirrored there — server is the reference, see A-D10). Hard gate is '
  'in complete_order_with_payment_v17.';

DROP FUNCTION IF EXISTS public.evaluate_promotions_v1(JSONB, UUID, NUMERIC);

GRANT EXECUTE ON FUNCTION public.evaluate_promotions_v2(JSONB, UUID, NUMERIC)
  TO authenticated, service_role;

-- Repoint the one other SQL caller (pay_existing_order_v11) to v2. In-place
-- CREATE OR REPLACE — signature unchanged, precedent _078/_081 (internal
-- dependency repoint is not a versioned behavior change to pay_existing_order
-- itself; it inherits the same advisory cap filtering complete_order gets).
CREATE OR REPLACE FUNCTION public.pay_existing_order_v11(
  p_order_id uuid,
  p_payment jsonb DEFAULT NULL::jsonb,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_loyalty_points_redeemed integer DEFAULT 0,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_discount_amount numeric DEFAULT 0,
  p_discount_type text DEFAULT NULL::text,
  p_discount_value numeric DEFAULT NULL::numeric,
  p_discount_reason text DEFAULT NULL::text,
  p_discount_authorized_by uuid DEFAULT NULL::uuid,
  p_promotions jsonb DEFAULT '[]'::jsonb,
  p_payments jsonb DEFAULT NULL::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id              UUID;
  v_profile_id           UUID;
  v_order                orders;
  v_items_total          DECIMAL(14,2) := 0;
  v_tax_rate             DECIMAL(5,4);
  v_allow_negative       BOOLEAN;
  v_redemption_amount    DECIMAL(14,2) := 0;
  v_total                DECIMAL(14,2);
  v_tax_amount           DECIMAL(14,2);
  v_loyalty_balance      INTEGER;
  v_points_earned        INTEGER := 0;
  v_je_id                UUID;
  v_loyalty_liab_id      UUID;
  v_sale_discount_id     UUID;
  v_item                 RECORD;
  v_promo                JSONB;
  v_promotion_total      DECIMAL(14,2) := 0;
  v_promo_id             UUID;
  v_promo_amount         DECIMAL(14,2);
  v_promo_record         promotions;
  v_customer_category_id UUID;
  v_now                  TIMESTAMPTZ := now();
  v_now_dow              INTEGER;
  v_now_hour             INTEGER;
  v_payments_arr         JSONB;
  v_payment_entry        JSONB;
  v_pay_count            INTEGER;
  v_pay_idx              INTEGER;
  v_pay_sum              DECIMAL(14,2) := 0;
  v_pay_method           payment_method;
  v_pay_amount           DECIMAL(14,2);
  v_pay_cash_recv        DECIMAL(14,2);
  v_pay_change           DECIMAL(14,2);
  v_total_change         DECIMAL(14,2) := 0;
  v_authorizer_uid       UUID;
  v_loyalty_multiplier   NUMERIC := 1.0;
  v_server_eval          JSONB;
  v_server_amount        DECIMAL(14,2);
  v_eval_items           JSONB;
  v_eval_subtotal        DECIMAL(14,2) := 0;
  v_comp                 JSONB;
  v_comp_qty             DECIMAL(10,3);
  -- Phase 2 (modifier ingredient deduction from persisted snapshot)
  v_ing                  RECORD;
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

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_order.id FROM orders WHERE idempotency_key = p_idempotency_key;
    IF v_order.id IS NOT NULL THEN
      RETURN (
        SELECT jsonb_build_object(
          'order_id',          o.id,
          'order_number',      o.order_number,
          'subtotal',          o.subtotal,
          'tax_amount',        o.tax_amount,
          'total',             o.total,
          'change_given',      (SELECT COALESCE(SUM(op.change_given), 0)
                                  FROM order_payments op WHERE op.order_id = o.id),
          'loyalty_points_earned', COALESCE(o.loyalty_points_earned, 0),
          'idempotent_replay', true
        ) FROM orders o WHERE o.id = v_order.id
      );
    END IF;
  END IF;

  IF p_discount_amount > 0 THEN
    IF p_discount_authorized_by IS NULL THEN
      RAISE EXCEPTION 'Discount requires an authorizing manager (p_discount_authorized_by)'
        USING ERRCODE = 'P0001';
    END IF;
    SELECT up.auth_user_id INTO v_authorizer_uid
      FROM user_profiles up
      WHERE up.id = p_discount_authorized_by AND up.deleted_at IS NULL;
    IF v_authorizer_uid IS NULL THEN
      RAISE EXCEPTION 'Discount authorizer not found' USING ERRCODE = 'P0003';
    END IF;
    IF NOT has_permission(v_authorizer_uid, 'sales.discount') THEN
      RAISE EXCEPTION 'Permission denied: sales.discount (authorizer)' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF p_payments IS NOT NULL AND p_payment IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot supply both p_payment and p_payments' USING ERRCODE = 'check_violation';
  END IF;
  IF p_payments IS NOT NULL THEN
    v_payments_arr := p_payments;
  ELSIF p_payment IS NOT NULL THEN
    v_payments_arr := jsonb_build_array(p_payment);
  ELSE
    RAISE EXCEPTION 'Must supply p_payment or p_payments' USING ERRCODE = 'check_violation';
  END IF;

  v_pay_count := jsonb_array_length(v_payments_arr);
  IF v_pay_count < 1 OR v_pay_count > 5 THEN
    RAISE EXCEPTION 'Invalid tender count: % (must be 1..5)', v_pay_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (v_order.status = 'draft'
          OR (v_order.status = 'pending_payment' AND v_order.created_via = 'pos')) THEN
    RAISE EXCEPTION 'Order is not payable (status: %, via: %)', v_order.status, v_order.created_via
      USING ERRCODE = 'check_violation';
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

  -- Read tax_rate and allow_negative_stock in a single query (avoids second round-trip).
  SELECT tax_rate, COALESCE(allow_negative_stock, true)
    INTO v_tax_rate, v_allow_negative
    FROM business_config WHERE id = 1;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_items_total
    FROM order_items
    WHERE order_id = p_order_id;

  SELECT COALESCE(SUM(oi.unit_price * oi.quantity), 0)
    INTO v_eval_subtotal
    FROM order_items oi
    WHERE oi.order_id = p_order_id AND oi.is_cancelled = false AND oi.is_promo_gift = false;

  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    v_now_dow  := EXTRACT(ISODOW FROM v_now)::INTEGER;
    v_now_hour := EXTRACT(HOUR  FROM v_now)::INTEGER;

    IF p_customer_id IS NOT NULL THEN
      SELECT category_id INTO v_customer_category_id
        FROM customers WHERE id = p_customer_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'product_id', oi.product_id::text,
             'quantity',   oi.quantity,
             'unit_price', oi.unit_price)), '[]'::jsonb)
      INTO v_eval_items
      FROM order_items oi
      WHERE oi.order_id = p_order_id AND oi.is_cancelled = false AND oi.is_promo_gift = false;

    -- S57 A-D5: evaluate_promotions_v1 -> v2 (capped promos filtered advisory).
    v_server_eval := evaluate_promotions_v2(
      p_cart_items  := v_eval_items,
      p_customer_id := p_customer_id,
      p_subtotal    := v_eval_subtotal
    );

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

      IF v_promo_record.start_at IS NOT NULL AND v_promo_record.start_at > v_now THEN
        RAISE EXCEPTION 'Promotion not yet active: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_promo_record.end_at IS NOT NULL AND v_promo_record.end_at < v_now THEN
        RAISE EXCEPTION 'Promotion expired: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;

      IF (v_promo_record.day_of_week_mask & (1 << (v_now_dow - 1))) = 0 THEN
        RAISE EXCEPTION 'Promotion not valid this day: %', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;

      IF v_promo_record.start_hour IS NOT NULL THEN
        IF v_now_hour < v_promo_record.start_hour
           OR v_now_hour >= v_promo_record.end_hour THEN
          RAISE EXCEPTION 'Promotion not valid this hour: %', v_promo_record.slug
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      IF v_items_total < v_promo_record.min_items_total THEN
        RAISE EXCEPTION 'Promotion min total not met: % (required %)',
          v_promo_record.slug, v_promo_record.min_items_total
          USING ERRCODE = 'check_violation';
      END IF;

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

      SELECT (sp->>'discount_amount')::DECIMAL(14,2) INTO v_server_amount
        FROM jsonb_array_elements(v_server_eval->'applied_promotions') sp
        WHERE (sp->>'promotion_id')::uuid = v_promo_id
        LIMIT 1;
      IF v_server_amount IS NULL THEN
        RAISE EXCEPTION 'Promotion amount mismatch: % not applicable to this cart', v_promo_record.slug
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_server_amount <> v_promo_amount THEN
        RAISE EXCEPTION 'Promotion amount mismatch: % (client %, server %)',
          v_promo_record.slug, v_promo_amount, v_server_amount
          USING ERRCODE = 'check_violation';
      END IF;

      v_promotion_total := v_promotion_total + v_promo_amount;
    END LOOP;
  END IF;

  v_total := v_items_total - v_redemption_amount - p_discount_amount - v_promotion_total;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discounts + promotions exceed items total' USING ERRCODE = 'check_violation';
  END IF;

  v_tax_amount := round_idr(v_total * v_tax_rate / (1 + v_tax_rate));

  v_pay_idx := 0;
  v_pay_sum := 0;
  v_total_change := 0;
  FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP
    v_pay_idx       := v_pay_idx + 1;
    v_pay_method    := (v_payment_entry->>'method')::payment_method;
    v_pay_amount    := (v_payment_entry->>'amount')::DECIMAL(14,2);
    v_pay_cash_recv := NULLIF(v_payment_entry->>'cash_received','')::DECIMAL(14,2);
    v_pay_change    := NULLIF(v_payment_entry->>'change_given','')::DECIMAL(14,2);

    IF v_pay_amount IS NULL OR v_pay_amount <= 0 THEN
      RAISE EXCEPTION 'Tender %: amount must be > 0', v_pay_idx USING ERRCODE = 'check_violation';
    END IF;

    IF v_pay_cash_recv IS NOT NULL AND v_pay_cash_recv > v_pay_amount AND v_pay_idx < v_pay_count THEN
      RAISE EXCEPTION 'Tender % (intermediate): cash_received cannot exceed amount', v_pay_idx
        USING ERRCODE = 'check_violation';
    END IF;

    IF v_pay_method = 'cash' THEN
      IF v_pay_cash_recv IS NOT NULL THEN
        IF v_pay_cash_recv < v_pay_amount AND v_pay_idx = v_pay_count THEN
          RAISE EXCEPTION 'Invalid change amount: cash_received (%) < amount (%)',
            v_pay_cash_recv, v_pay_amount USING ERRCODE = 'check_violation';
        END IF;
        IF COALESCE(v_pay_change, 0) <> GREATEST(v_pay_cash_recv - v_pay_amount, 0) THEN
          RAISE EXCEPTION 'Invalid change amount: change_given (%) != cash_received - amount (%)',
            COALESCE(v_pay_change, 0), GREATEST(v_pay_cash_recv - v_pay_amount, 0)
            USING ERRCODE = 'check_violation';
        END IF;
      ELSIF COALESCE(v_pay_change, 0) <> 0 THEN
        RAISE EXCEPTION 'Invalid change amount: change without cash_received'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF COALESCE(v_pay_change, 0) <> 0 THEN
      RAISE EXCEPTION 'Invalid change amount: non-cash tender cannot give change'
        USING ERRCODE = 'check_violation';
    END IF;

    v_pay_sum := v_pay_sum + v_pay_amount;
    IF v_pay_change IS NOT NULL THEN
      v_total_change := v_total_change + v_pay_change;
    END IF;
  END LOOP;

  IF v_pay_sum <> v_total THEN
    RAISE EXCEPTION 'Sum of tender amounts (%) != order total (%)', v_pay_sum, v_total
      USING ERRCODE = 'check_violation';
  END IF;

  FOR v_item IN
    SELECT oi.product_id, oi.quantity, oi.combo_components, oi.modifier_ingredients_deducted,
           p.name, p.current_stock, p.unit, p.is_display_item, p.product_type
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = p_order_id
      FOR UPDATE OF p
  LOOP
    IF v_item.product_type = 'combo' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.combo_components, '[]'::jsonb)) LOOP
        v_comp_qty := (v_comp->>'quantity')::DECIMAL * v_item.quantity;
        PERFORM _record_sale_stock_v1(
          p_product_id     := (v_comp->>'product_id')::UUID,
          p_quantity       := v_comp_qty,
          p_reference_id   := p_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS combo sale (pay existing)',
          p_allow_negative := v_allow_negative
        );
      END LOOP;
    ELSE
      PERFORM _record_sale_stock_v1(
        p_product_id     := v_item.product_id,
        p_quantity       := v_item.quantity,
        p_reference_id   := p_order_id,
        p_created_by     := v_profile_id,
        p_reason         := 'POS sale (pay existing)',
        p_unit           := v_item.unit,
        p_allow_negative := v_allow_negative
      );
    END IF;

    -- Phase 2: deduct the persisted modifier-ingredient snapshot for this line
    -- (display-aware). The helper owns the FOR UPDATE lock, NOT FOUND check, and guard.
    IF v_item.modifier_ingredients_deducted IS NOT NULL THEN
      FOR v_ing IN
        SELECT * FROM jsonb_to_recordset(v_item.modifier_ingredients_deducted)
          AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)
      LOOP
        PERFORM _record_sale_stock_v1(
          p_product_id     := v_ing.product_id,
          p_quantity       := v_ing.qty_base,
          p_reference_id   := p_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS modifier (pay existing): ' || v_ing.group_name || ' / ' || v_ing.option_label,
          p_unit           := v_ing.unit,
          p_allow_negative := v_allow_negative
        );
      END LOOP;
    END IF;
  END LOOP;

  UPDATE orders SET
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
    promotion_total           = v_promotion_total,
    updated_at                = now()
    WHERE id = p_order_id;

  IF p_discount_amount > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.discount_applied', 'orders', p_order_id, jsonb_build_object(
        'order_number',          v_order.order_number,
        'order_discount_amount', p_discount_amount,
        'discount_type',         p_discount_type,
        'discount_value',        p_discount_value,
        'discount_reason',       p_discount_reason,
        'authorized_by',         p_discount_authorized_by,
        'pin_gated',             false,
        'rpc_version',           'v11-s53'
      ));
  END IF;

  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
      INSERT INTO promotion_applications (order_id, promotion_id, amount, description)
      VALUES (
        p_order_id,
        (v_promo->>'promotion_id')::UUID,
        (v_promo->>'amount')::DECIMAL(14,2),
        COALESCE(v_promo->>'description', '')
      );
    END LOOP;
  END IF;

  FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP
    INSERT INTO order_payments (
      order_id, method, amount, cash_received, change_given, reference
    ) VALUES (
      p_order_id,
      (v_payment_entry->>'method')::payment_method,
      (v_payment_entry->>'amount')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'cash_received','')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'change_given','')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'reference','')
    );
  END LOOP;

  UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = p_order_id;

  IF v_redemption_amount > 0 THEN
    SELECT id INTO v_je_id
      FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = p_order_id;

    v_loyalty_liab_id  := resolve_mapping_account('LOYALTY_LIABILITY');
    v_sale_discount_id := resolve_mapping_account('SALE_DISCOUNT');

    IF v_je_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_loyalty_liab_id, v_redemption_amount, 0,                   'Loyalty redemption — DR liability'),
        (v_je_id, v_sale_discount_id, 0,                  v_redemption_amount, 'Loyalty redemption — CR discount');

      UPDATE journal_entries
        SET total_debit  = total_debit  + v_redemption_amount,
            total_credit = total_credit + v_redemption_amount
        WHERE id = v_je_id;
    END IF;
  END IF;

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

  IF p_customer_id IS NOT NULL AND v_total > 0 THEN
    SELECT get_loyalty_multiplier(c.lifetime_points) * COALESCE(cc.points_multiplier, 1.0)
      INTO v_loyalty_multiplier
      FROM customers c
      LEFT JOIN customer_categories cc ON cc.id = c.category_id
      WHERE c.id = p_customer_id;
    v_loyalty_multiplier := COALESCE(v_loyalty_multiplier, 1.0);

    v_points_earned := FLOOR(v_total * v_loyalty_multiplier / 1000);

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

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.pay_existing', 'orders', p_order_id, jsonb_build_object(
      'order_number',    v_order.order_number,
      'items_total',     v_items_total,
      'total',           v_total,
      'redemption',      v_redemption_amount,
      'discount_amount', p_discount_amount,
      'promotion_total', v_promotion_total,
      'tender_count',    v_pay_count,
      'payment_methods', (SELECT jsonb_agg(DISTINCT op.method::TEXT)
                          FROM order_payments op WHERE op.order_id = p_order_id),
      'rpc_version',     'v11-s53'
    ));

  RETURN jsonb_build_object(
    'order_id',                p_order_id,
    'order_number',            v_order.order_number,
    'subtotal',                v_items_total,
    'tax_amount',              v_tax_amount,
    'total',                   v_total,
    'change_given',            v_total_change,
    'loyalty_points_earned',   v_points_earned,
    'idempotent_replay',       false
  );
END $function$;
