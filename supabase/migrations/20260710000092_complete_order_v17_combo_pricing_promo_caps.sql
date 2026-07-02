-- 20260710000092_complete_order_v17_combo_pricing_promo_caps.sql
-- S57 P2.1 (Chantier A, A-D1/A-D2/A-D3/A-D5) — complete_order_with_payment_v16 -> v17.
-- Body copied verbatim from v16 (_086) with exactly 4 hunks:
--   1. Combo line pricing/validation (loop 1, ~totals+eval_subtotal accumulation):
--      unit_price for combo lines is now `_resolve_combo_price_v1(product_id,
--      combo_components)` (base + Sigma surcharge, validated against
--      combo_groups/combo_group_options) instead of the plain combo_base_price
--      returned by _resolve_line_price_v1 — closes the A-D1 revenue leak.
--      product_modifiers on the combo product itself (a SEPARATE mechanism from
--      combo_groups — e.g. a size upsell) are still resolved via
--      _resolve_line_price_v1 and preserved unchanged (v_srv_mod_per_unit /
--      v_srv_mods_resolved untouched by this hunk).
--   2. Same override repeated in loop 2 (order_items INSERT + lines[] snapshot)
--      — v16 already recomputes _resolve_line_price_v1 independently in both
--      loops, this hunk mirrors that duplication for the combo override.
--   3. evaluate_promotions_v1 -> v2 call (advisory cap filtering, S57 A-D5).
--   4. Hard cap gate (A-D5) inserted at the promotion_applications INSERT loop:
--      pg_advisory_xact_lock(hashtext(promotion_id)) -> re-count (same rule as
--      evaluate_promotions_v2) -> RAISE 'promo_cap_exceeded' if exceeded.
-- Incidental fix while rewriting: the 'rpc_version' values in the two audit_logs
-- inserts ('order.price_overridden', 'order.complete') were stuck at 'v15' since
-- _074/_086 (copy-paste drift) — corrected to 'v17' here.
--
-- ⚠️ CRITICAL (caveat S51/S53/S55, still applies): GRANT EXECUTE TO authenticated
-- is REQUIRED — the EF calls this RPC with the user's JWT, not service_role.

CREATE OR REPLACE FUNCTION public.complete_order_with_payment_v17(
  p_session_id uuid,
  p_order_type order_type,
  p_items jsonb,
  p_payment jsonb DEFAULT NULL::jsonb,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_loyalty_points_redeemed integer DEFAULT 0,
  p_table_number text DEFAULT NULL::text,
  p_discount_amount numeric DEFAULT 0,
  p_discount_type text DEFAULT NULL::text,
  p_discount_value numeric DEFAULT NULL::numeric,
  p_discount_reason text DEFAULT NULL::text,
  p_discount_authorized_by uuid DEFAULT NULL::uuid,
  p_promotions jsonb DEFAULT '[]'::jsonb,
  p_payments jsonb DEFAULT NULL::jsonb,
  p_discount_auth_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_product_id           UUID;
  v_quantity             DECIMAL(10,3);
  v_unit_price           DECIMAL(14,2);
  v_expected_price       DECIMAL(14,2);
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
  v_payment_methods_agg  JSONB;
  v_has_discount         BOOLEAN := false;
  v_authorizer_uid       UUID;
  v_price_overrides      JSONB := '[]'::jsonb;
  v_loyalty_balance_after INTEGER;
  v_loyalty_multiplier   NUMERIC := 1.0;
  v_server_eval          JSONB;
  v_server_amount        DECIMAL(14,2);
  v_eval_items           JSONB;
  v_eval_subtotal        DECIMAL(14,2) := 0;
  v_comp                 JSONB;
  v_comp_product         RECORD;
  v_comp_qty             DECIMAL(10,3);
  v_item_product_type    TEXT;
  v_combo_base           DECIMAL(12,2);
  -- Phase 2 (modifier ingredient deduction)
  v_ing                  RECORD;
  v_ing_stock            DECIMAL(14,3);
  v_ing_is_display       BOOLEAN;
  v_ing_track            BOOLEAN;
  v_mod_ingredients      JSONB;
  -- Task 4 (flag-aware deduction + negative-stock setting)
  v_allow_negative       BOOLEAN;
  v_line_track           BOOLEAN;
  v_line_deduct          BOOLEAN;
  v_cons                 RECORD;
  -- V15 (canonical server line-price)
  v_srv_unit_price       DECIMAL(14,2);
  v_srv_mod_per_unit     DECIMAL(14,2);
  v_srv_line_subtotal    DECIMAL(14,2);
  v_srv_mods_resolved    JSONB;
  v_lines_agg            JSONB := '[]'::jsonb;
  v_line_id              UUID;
  -- S57 A-D1/A-D2 (combo server pricing) + A-D5 (promo usage caps hard gate)
  v_combo_price          DECIMAL(14,2);
  v_cap_max_uses         INT;
  v_cap_max_per_customer INT;
  v_uses_global          INT;
  v_uses_customer        INT;
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
          'order_id',          o.id,
          'order_number',      o.order_number,
          'subtotal',          o.subtotal,
          'tax_amount',        o.tax_amount,
          'total',             o.total,
          'change_given',      (SELECT COALESCE(SUM(op.change_given), 0)
                                  FROM order_payments op WHERE op.order_id = o.id),
          'loyalty_points_earned', COALESCE(o.loyalty_points_earned, 0),
          'loyalty_balance_after', (SELECT c.loyalty_points FROM customers c WHERE c.id = o.customer_id),
          'idempotent_replay', true
        ) FROM orders o WHERE o.id = v_order_id
      );
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

  -- Task 4 (B): tax_rate + reglage global stock negatif.
  SELECT tax_rate, allow_negative_stock INTO v_tax_rate, v_allow_negative
    FROM business_config WHERE id = 1;
  v_allow_negative := COALESCE(v_allow_negative, true);

  v_items_total := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
      FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id' USING ERRCODE = 'P0002';
    END IF;

    v_quantity      := (v_item->>'quantity')::DECIMAL;
    v_unit_price    := (v_item->>'unit_price')::DECIMAL;
    v_item_is_gift  := COALESCE((v_item->>'is_promo_gift')::BOOLEAN, false);
    v_item_promo_id := NULLIF(v_item->>'promotion_id', '')::UUID;

    -- V15 (A): resolution canonique du prix de ligne (ignore price_adjustment client).
    SELECT lp.unit_price, lp.modifiers_total, lp.line_subtotal, lp.modifiers_resolved
      INTO v_srv_unit_price, v_srv_mod_per_unit, v_srv_line_subtotal, v_srv_mods_resolved
      FROM _resolve_line_price_v1(
        v_product.id,
        v_quantity,
        COALESCE(v_item->'modifiers', '[]'::jsonb),
        p_customer_id,
        v_item_is_gift,
        (v_product.product_type = 'combo')
      ) lp;

    IF v_product.product_type = 'combo' THEN
      -- S57 A-D1/A-D2: real combo pricing (base + Sigma surcharge) + composition
      -- validation in one pass. Overrides the plain combo_base_price returned
      -- above by _resolve_line_price_v1. product_modifiers on the combo product
      -- itself (separate mechanism, e.g. size upsell) stay untouched — only
      -- v_srv_unit_price / v_srv_line_subtotal are recomputed here.
      IF NOT v_item_is_gift THEN
        v_combo_price := _resolve_combo_price_v1(
          v_product.id, COALESCE(v_item->'combo_components', '[]'::jsonb)
        );
        v_srv_unit_price    := v_combo_price;
        v_srv_line_subtotal := round_idr((v_srv_unit_price + v_srv_mod_per_unit) * v_quantity);
      END IF;

      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'combo_components', '[]'::jsonb)) LOOP
        SELECT * INTO v_comp_product FROM products
          WHERE id = (v_comp->>'product_id')::UUID FOR UPDATE;
        IF v_comp_product.id IS NULL THEN
          RAISE EXCEPTION 'Combo component not found: %', v_comp->>'product_id' USING ERRCODE = 'P0002';
        END IF;
        v_comp_qty := (v_comp->>'quantity')::DECIMAL * v_quantity;
        -- Task 4 (D): gate combo par allow_negative.
        IF v_comp_product.is_display_item THEN
          IF NOT v_allow_negative
             AND COALESCE((SELECT quantity FROM display_stock WHERE product_id = v_comp_product.id), 0) < v_comp_qty THEN
            RAISE EXCEPTION 'Insufficient display stock for combo component % (need %)',
              v_comp_product.name, v_comp_qty USING ERRCODE = 'P0002';
          END IF;
        ELSIF NOT v_allow_negative AND v_comp_product.track_inventory AND v_comp_product.current_stock < v_comp_qty THEN
          RAISE EXCEPTION 'Insufficient stock for combo component % (have %, need %)',
            v_comp_product.name, v_comp_product.current_stock, v_comp_qty USING ERRCODE = 'P0002';
        END IF;
      END LOOP;
      -- v_eval_subtotal : base seulement, sans modifier
      v_eval_subtotal := v_eval_subtotal + round_idr(v_srv_unit_price * v_quantity);
    ELSE
      -- Task 4 (C): validation flag-aware, gardee par allow_negative.
      IF v_product.is_display_item THEN
        IF NOT v_allow_negative
           AND COALESCE((SELECT quantity FROM display_stock WHERE product_id = v_product.id), 0) < v_quantity THEN
          RAISE EXCEPTION 'Insufficient display stock for product % (need %)',
            v_product.name, v_quantity USING ERRCODE = 'P0002';
        END IF;
      ELSIF v_product.track_inventory THEN
        IF NOT v_allow_negative AND v_product.current_stock < v_quantity THEN
          RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
            v_product.name, v_product.current_stock, v_quantity USING ERRCODE = 'P0002';
        END IF;
      ELSIF v_product.deduct_stock THEN
        IF NOT v_allow_negative THEN
          FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_product.id, v_quantity) LOOP
            SELECT current_stock INTO v_ing_stock FROM products WHERE id = v_cons.product_id FOR UPDATE;
            IF COALESCE(v_ing_stock, 0) < v_cons.qty_base THEN
              RAISE EXCEPTION 'Insufficient stock for recipe component % (need %, have %)',
                v_cons.product_id, v_cons.qty_base, COALESCE(v_ing_stock, 0) USING ERRCODE = 'P0002';
            END IF;
          END LOOP;
        END IF;
      END IF;

      -- Phase 2: modifier ingredient availability check (non-combo line).
      FOR v_ing IN
        SELECT * FROM jsonb_to_recordset(
          _resolve_modifier_ingredients_v1(v_product.id, v_item->'modifiers', v_quantity)
        ) AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)
      LOOP
        SELECT current_stock, is_display_item, COALESCE(track_inventory, true)
          INTO v_ing_stock, v_ing_is_display, v_ing_track
          FROM products WHERE id = v_ing.product_id FOR UPDATE;
        IF v_ing_is_display THEN
          SELECT quantity INTO v_ing_stock FROM display_stock WHERE product_id = v_ing.product_id;
        END IF;
        -- Task 4 (D): gate modificateur par allow_negative.
        IF NOT v_allow_negative AND v_ing_track AND COALESCE(v_ing_stock, 0) < v_ing.qty_base THEN
          RAISE EXCEPTION 'Insufficient stock for modifier ingredient % (need %, have %)',
            v_ing.product_id, v_ing.qty_base, COALESCE(v_ing_stock, 0)
            USING ERRCODE = 'P0002';
        END IF;
      END LOOP;

      IF v_item_is_gift AND (v_item_promo_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_promotions, '[]'::jsonb)) e
        WHERE (e->>'promotion_id')::uuid = v_item_promo_id
      )) THEN
        RAISE EXCEPTION 'Gift line requires a matching declared promotion'
          USING ERRCODE = 'check_violation';
      END IF;
      -- V15 (D4): override prix de base divergent - log audit conserve (pas de rejet).
      IF NOT v_item_is_gift THEN
        IF v_unit_price IS DISTINCT FROM v_srv_unit_price THEN
          v_price_overrides := v_price_overrides || jsonb_build_object(
            'product_id',          v_product.id,
            'client_unit_price',   v_unit_price,
            'expected_unit_price', v_srv_unit_price
          );
        END IF;
        -- v_eval_subtotal : base seulement, sans modifier
        v_eval_subtotal := v_eval_subtotal + round_idr(v_srv_unit_price * v_quantity);
      END IF;
    END IF;

    -- V15 (A): utilise les valeurs serveur pour le total (ignore price_adjustment client).
    v_line_discount := COALESCE((v_item->>'discount_amount')::DECIMAL(14,2), 0);
    IF v_line_discount > 0 THEN
      v_has_discount := true;
    END IF;
    v_line_total    := v_srv_line_subtotal - v_line_discount;
    v_items_total   := v_items_total + v_line_total;
  END LOOP;

  IF p_discount_amount > 0 THEN
    v_has_discount := true;
  END IF;
  IF v_has_discount THEN
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
    -- S55 T7 : le PIN n'entre plus dans ce statement. L'EF process-payment l'a
    -- vérifié (helpers manager-pin, bucket SEC-07) et a minté un nonce
    -- single-use service-role-only. Consommation atomique : un nonce ne sert
    -- qu'une fois, expire à 60 s, et doit désigner le même manager.
    UPDATE discount_authorizations
       SET consumed_at = now()
     WHERE id = p_discount_auth_id
       AND consumed_at IS NULL
       AND expires_at > now()
       AND scope = 'discount'
       AND manager_profile_id = p_discount_authorized_by;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid manager PIN for discount authorization'
        USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    v_now_dow  := EXTRACT(ISODOW FROM v_now)::INTEGER;
    v_now_hour := EXTRACT(HOUR  FROM v_now)::INTEGER;

    IF p_customer_id IS NOT NULL THEN
      SELECT category_id INTO v_customer_category_id
        FROM customers WHERE id = p_customer_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'product_id', item->>'product_id',
             'quantity',   (item->>'quantity')::numeric,
             'unit_price', (item->>'unit_price')::numeric)), '[]'::jsonb)
      INTO v_eval_items
      FROM jsonb_array_elements(p_items) AS item
      WHERE COALESCE((item->>'is_promo_gift')::boolean, false) = false;

    -- S57 A-D5: evaluate_promotions_v1 -> v2 (advisory cap filtering).
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

    -- V15 (C) - D2 : valider chaque ligne-cadeau contre les free_items evalues serveur.
    -- Le check existant (boucle 1) garantit que promotion_id est dans p_promotions.
    -- On valide ici que product_id + quantity sont couverts par les free_items autorises.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      IF NOT COALESCE((v_item->>'is_promo_gift')::boolean, false) THEN CONTINUE; END IF;
      v_item_promo_id := NULLIF(v_item->>'promotion_id', '')::UUID;
      IF NOT EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_server_eval->'applied_promotions') sp
          CROSS JOIN LATERAL jsonb_array_elements(
            COALESCE(sp->'free_items', '[]'::jsonb)
          ) fi
          WHERE (sp->>'promotion_id')::uuid = v_item_promo_id
            AND (fi->>'product_id')::uuid   = (v_item->>'product_id')::uuid
            AND (fi->>'quantity')::numeric  >= (v_item->>'quantity')::numeric
      ) THEN
        RAISE EXCEPTION 'Gift line not authorized by server-evaluated promotion'
          USING ERRCODE = 'check_violation';
      END IF;
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

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total,
    customer_id, loyalty_points_redeemed, loyalty_redemption_amount,
    idempotency_key, paid_at, table_number,
    discount_amount, discount_type, discount_value, discount_reason, discount_authorized_by,
    promotion_total
  ) VALUES (
    v_order_number, p_session_id, v_profile_id, p_order_type, 'pending_payment',
    v_items_total, v_tax_amount, v_total,
    p_customer_id, p_loyalty_points_redeemed, v_redemption_amount,
    p_idempotency_key, NULL, p_table_number,
    p_discount_amount, p_discount_type, p_discount_value, p_discount_reason, p_discount_authorized_by,
    v_promotion_total
  ) RETURNING id INTO v_order_id;

  IF v_has_discount AND p_discount_auth_id IS NOT NULL THEN
    UPDATE discount_authorizations SET consumed_order_id = v_order_id WHERE id = p_discount_auth_id;
  END IF;

  IF v_has_discount THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.discount_applied', 'orders', v_order_id, jsonb_build_object(
        'order_number',          v_order_number,
        'order_discount_amount', p_discount_amount,
        'discount_type',         p_discount_type,
        'discount_value',        p_discount_value,
        'discount_reason',       p_discount_reason,
        'authorized_by',         p_discount_authorized_by,
        'rpc_version',           'v17'
      ));
  END IF;

  IF jsonb_array_length(v_price_overrides) > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.price_overridden', 'orders', v_order_id, jsonb_build_object(
        'order_number', v_order_number,
        'overrides',    v_price_overrides,
        'rpc_version',  'v17'
      ));
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_item_is_gift  := COALESCE((v_item->>'is_promo_gift')::BOOLEAN, false);
    v_item_promo_id := NULLIF(v_item->>'promotion_id', '')::UUID;

    SELECT product_type, combo_base_price INTO v_item_product_type, v_combo_base
      FROM products WHERE id = v_product_id;

    -- V15 (B): resolution canonique (identique a la boucle 1, valeurs serveur garanties).
    SELECT lp.unit_price, lp.modifiers_total, lp.line_subtotal, lp.modifiers_resolved
      INTO v_srv_unit_price, v_srv_mod_per_unit, v_srv_line_subtotal, v_srv_mods_resolved
      FROM _resolve_line_price_v1(
        v_product_id,
        v_quantity,
        COALESCE(v_item->'modifiers', '[]'::jsonb),
        p_customer_id,
        v_item_is_gift,
        (v_item_product_type = 'combo')
      ) lp;

    -- S57 A-D1/A-D2: mirror the loop-1 combo override (see hunk 1 comment above).
    IF v_item_product_type = 'combo' AND NOT v_item_is_gift THEN
      v_combo_price := _resolve_combo_price_v1(
        v_product_id, COALESCE(v_item->'combo_components', '[]'::jsonb)
      );
      v_srv_unit_price    := v_combo_price;
      v_srv_line_subtotal := round_idr((v_srv_unit_price + v_srv_mod_per_unit) * v_quantity);
    END IF;

    -- Snapshot modifiers avec price_adjustment serveur (pas client)
    v_modifiers       := v_srv_mods_resolved;
    v_modifiers_total := round_idr(v_srv_mod_per_unit * v_quantity);
    v_line_discount   := COALESCE((v_item->>'discount_amount')::DECIMAL(14,2), 0);
    v_line_total      := v_srv_line_subtotal - v_line_discount;

    SELECT c.dispatch_station
      INTO v_dispatch_station
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    -- Phase 2: resolve+convert the modifier ingredient snapshot for this line
    v_mod_ingredients := CASE
      WHEN v_item_product_type <> 'combo'
      THEN NULLIF(_resolve_modifier_ingredients_v1(v_product_id, v_modifiers, v_quantity), '[]'::jsonb)
      ELSE NULL END;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station, combo_components,
      discount_amount, discount_type, discount_value, discount_reason,
      is_promo_gift, promotion_id, modifier_ingredients_deducted
    )
    SELECT
      v_order_id, p.id, p.name, v_srv_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station,
      CASE WHEN v_item_product_type = 'combo' THEN COALESCE(v_item->'combo_components', '[]'::jsonb) ELSE NULL END,
      v_line_discount,
      NULLIF(v_item->>'discount_type', ''),
      CASE WHEN (v_item->>'discount_value') IS NOT NULL AND (v_item->>'discount_value') <> ''
           THEN (v_item->>'discount_value')::DECIMAL(14,2)
           ELSE NULL END,
      NULLIF(v_item->>'discount_reason', ''),
      v_item_is_gift,
      v_item_promo_id,
      v_mod_ingredients
    FROM products p WHERE p.id = v_product_id
    RETURNING id INTO v_line_id;

    -- V15 (D): accumulation de la ventilation par ligne (valeurs serveur)
    v_lines_agg := v_lines_agg || jsonb_build_array(jsonb_build_object(
      'line_id',         v_line_id,
      'product_id',      v_product_id,
      'quantity',        v_quantity,
      'unit_price',      v_srv_unit_price,
      'modifiers_total', v_srv_mod_per_unit,
      'line_subtotal',   v_srv_line_subtotal,
      'line_discount',   v_line_discount,
      'line_total',      v_line_total
    ));

    IF v_item_product_type = 'combo' THEN
      -- (A) Combo components: route through helper (display + stock unified).
      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_item->'combo_components', '[]'::jsonb)) LOOP
        v_comp_qty := (v_comp->>'quantity')::DECIMAL * v_quantity;

        PERFORM _record_sale_stock_v1(
          p_product_id     := (v_comp->>'product_id')::UUID,
          p_quantity       := v_comp_qty,
          p_reference_id   := v_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS combo sale',
          p_allow_negative := v_allow_negative
        );
      END LOOP;
    ELSE
      -- Task 4 (E): deduction flag-aware.
      SELECT track_inventory, deduct_stock INTO v_line_track, v_line_deduct
        FROM products WHERE id = v_product_id;

      IF v_line_track THEN
        -- (B) Simple tracked line: route through helper.
        PERFORM _record_sale_stock_v1(
          p_product_id     := v_product_id,
          p_quantity       := v_quantity,
          p_reference_id   := v_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS sale',
          p_allow_negative := v_allow_negative
        );

      ELSIF v_line_deduct THEN
        -- (C) Recipe consumption: cascade via helper, unit passed explicitly.
        FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_product_id, v_quantity) LOOP
          PERFORM _record_sale_stock_v1(
            p_product_id     := v_cons.product_id,
            p_quantity       := v_cons.qty_base,
            p_reference_id   := v_order_id,
            p_created_by     := v_profile_id,
            p_reason         := 'POS recipe consumption',
            p_unit           := v_cons.unit,
            p_allow_negative := v_allow_negative
          );
        END LOOP;
      END IF;
      -- (track_inventory=false AND deduct_stock=false) -> aucune deduction.
    END IF;

    -- Phase 2: deduct the resolved modifier ingredients for this (non-combo) line.
    IF v_mod_ingredients IS NOT NULL THEN
      -- (D) Modifier ingredients: route through helper, unit passed explicitly.
      FOR v_ing IN
        SELECT * FROM jsonb_to_recordset(v_mod_ingredients)
          AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT)
      LOOP
        PERFORM _record_sale_stock_v1(
          p_product_id     := v_ing.product_id,
          p_quantity       := v_ing.qty_base,
          p_reference_id   := v_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'POS modifier: ' || v_ing.group_name || ' / ' || v_ing.option_label,
          p_unit           := v_ing.unit,
          p_allow_negative := v_allow_negative
        );
      END LOOP;
    END IF;
  END LOOP;

  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
      v_promo_id := (v_promo->>'promotion_id')::UUID;

      -- S57 A-D5: hard gate — atomic re-check of usage caps at the money-path
      -- INSERT (evaluate_promotions_v2 is advisory-only, called upstream on a
      -- prior snapshot; a race between two concurrent checkouts of the last
      -- available use must be closed here). Lock serializes per-promotion.
      PERFORM pg_advisory_xact_lock(hashtext(v_promo_id::text));

      SELECT max_uses, max_uses_per_customer
        INTO v_cap_max_uses, v_cap_max_per_customer
        FROM promotions WHERE id = v_promo_id;

      IF v_cap_max_uses IS NOT NULL THEN
        SELECT count(*) INTO v_uses_global
          FROM promotion_applications pa
          JOIN orders o ON o.id = pa.order_id
          WHERE pa.promotion_id = v_promo_id AND o.voided_at IS NULL;
        IF v_uses_global >= v_cap_max_uses THEN
          RAISE EXCEPTION 'promo_cap_exceeded: promotion % has reached its global usage limit (%)',
            v_promo_id, v_cap_max_uses USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      IF v_cap_max_per_customer IS NOT NULL AND p_customer_id IS NOT NULL THEN
        SELECT count(*) INTO v_uses_customer
          FROM promotion_applications pa
          JOIN orders o ON o.id = pa.order_id
          WHERE pa.promotion_id = v_promo_id
            AND o.customer_id = p_customer_id
            AND o.voided_at IS NULL;
        IF v_uses_customer >= v_cap_max_per_customer THEN
          RAISE EXCEPTION 'promo_cap_exceeded: promotion % has reached its per-customer usage limit (%)',
            v_promo_id, v_cap_max_per_customer USING ERRCODE = 'check_violation';
        END IF;
      END IF;

      INSERT INTO promotion_applications (order_id, promotion_id, amount, description)
      VALUES (
        v_order_id,
        v_promo_id,
        (v_promo->>'amount')::DECIMAL(14,2),
        COALESCE(v_promo->>'description', '')
      );
    END LOOP;
  END IF;

  FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP
    INSERT INTO order_payments (
      order_id, method, amount, cash_received, change_given, reference
    ) VALUES (
      v_order_id,
      (v_payment_entry->>'method')::payment_method,
      (v_payment_entry->>'amount')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'cash_received','')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'change_given','')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'reference','')
    );
  END LOOP;

  UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = v_order_id;

  IF v_redemption_amount > 0 THEN
    SELECT id INTO v_je_id
      FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = v_order_id;

    v_loyalty_liab_id  := resolve_mapping_account('LOYALTY_LIABILITY');
    v_sale_discount_id := resolve_mapping_account('SALE_DISCOUNT');

    IF v_je_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
        (v_je_id, v_loyalty_liab_id, v_redemption_amount, 0,                   'Loyalty redemption -- DR liability'),
        (v_je_id, v_sale_discount_id, 0,                  v_redemption_amount, 'Loyalty redemption -- CR discount');

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
      p_customer_id, v_order_id, 'redeem', -p_loyalty_points_redeemed,
      v_loyalty_balance - p_loyalty_points_redeemed,
      'Redemption on order ' || v_order_id::text, v_profile_id
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

  IF p_customer_id IS NOT NULL THEN
    SELECT loyalty_points INTO v_loyalty_balance_after
      FROM customers WHERE id = p_customer_id;
  END IF;

  SELECT jsonb_agg(DISTINCT op.method::TEXT)
    INTO v_payment_methods_agg
    FROM order_payments op WHERE op.order_id = v_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_profile_id, 'order.complete', 'orders', v_order_id, jsonb_build_object(
      'order_number',     v_order_number,
      'items_total',      v_items_total,
      'total',            v_total,
      'redemption',       v_redemption_amount,
      'discount_amount',  p_discount_amount,
      'promotion_total',  v_promotion_total,
      'tender_count',     v_pay_count,
      'payment_methods',  v_payment_methods_agg,
      'table_number',     p_table_number,
      'rpc_version',      'v17'
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
    'loyalty_balance_after',     v_loyalty_balance_after,
    'customer_id',               p_customer_id,
    'table_number',              p_table_number,
    'tender_count',              v_pay_count,
    'change_given',              v_total_change,
    'lines',                     v_lines_agg
  );
END $function$;

DROP FUNCTION IF EXISTS public.complete_order_with_payment_v16(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid);

REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v17(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v17(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) FROM anon;
-- ⚠️ CAVEAT S51/S53/S55 (still applies) : l'EF appelle avec le JWT utilisateur.
-- Sans ce grant, toute la money-path casse en `permission denied`.
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v17(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v17(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) TO service_role;
