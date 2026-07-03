-- 20260710000095_fix_evaluate_promotions_v2_no_tier_column.sql
-- S57 fix (plage 1a) : _091 copiait le corps HISTORIQUE de v1 (_082) qui lisait
-- customers.tier_id — colonne inexistante dans le schema actuel (la v1 LIVE
-- avait ete patchee cote cloud, bookkeeping clock-stampe, pas de fichier local).
-- Symptome : 42703 "tier_id" does not exist des qu'un p_customer_id est
-- fourni. Fix in-place (CREATE OR REPLACE, meme signature) : lookup category_id
-- seul ; v_customer_tier reste NULL (customer_tier_ids = vestigial, une promo
-- restreinte par tiers ne s'applique jamais — parite avec la v1 live).

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
    SELECT category_id
    INTO   v_customer_cat
    FROM   customers
    WHERE  id = p_customer_id;
    -- S57 fix (_095) : la colonne customers "tier" n'existe pas dans le schema actuel —
    -- v_customer_tier reste NULL ; une promo restreinte par customer_tier_ids
    -- (colonne vestigiale) ne s'applique donc jamais, comme la v1 live.
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

