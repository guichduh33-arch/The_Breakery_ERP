-- ADR-013 Lot 2 D9 — pay_existing_order_v14 : la remise money-path exige le nonce
-- PIN manager à usage unique (discount_authorizations), consommé atomiquement —
-- exactement comme complete_order_with_payment_v19. Clôt E1 : le client ne peut
-- plus asserter un p_discount_authorized_by « nu » ; l'identité est cross-checkée
-- contre un nonce que seul le service-role (verify-manager-pin, après vérif PIN)
-- peut minter. Corps = v13 verbatim + le bloc de consommation.
--
-- Décision offline (AskUserQuestion 2026-07-26) : un replay offline
-- (p_offline_replay=true) BYPASSE la garde nonce — la vente a été autorisée en
-- ligne au moment de la saisie ; le replay ne fait que la rejouer. Tracé dans
-- audit_logs (pin_gated=false, offline_replay=true). En pratique offlineReplay.ts
-- paie sans discount, donc la garde n'y est jamais atteinte (ceinture-bretelle).
--
-- ACL répliquée à l'identique de v13 (authenticated + service_role) + REVOKE
-- défense-en-profondeur (CLAUDE.md anon/PUBLIC).

CREATE OR REPLACE FUNCTION public.pay_existing_order_v14(
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
  p_discount_auth_id uuid DEFAULT NULL::uuid,
  p_promotions jsonb DEFAULT '[]'::jsonb,
  p_payments jsonb DEFAULT NULL::jsonb,
  p_offline_replay boolean DEFAULT false)
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
  v_ing                  RECORD;
  -- S57 guardian fix (_096) : gate dur plafonds promo, miroir de _092.
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
    -- ADR-013 D9 — consommation atomique du nonce PIN manager (miroir exact de
    -- complete_order_with_payment_v19). Le nonce lie l'autorisateur au PIN vérifié
    -- côté service-role : p_discount_authorized_by n'est plus cru « nu ». Bypass
    -- au replay offline (la remise a déjà été autorisée en ligne à la saisie).
    IF NOT p_offline_replay THEN
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

  SELECT COALESCE(allow_negative_stock, true)
    INTO v_allow_negative
    FROM business_config WHERE id = 1;

  -- Spec 006x lot 4 (arbitrage A4) : un replay de vente encaissée hors-ligne
  -- n'est JAMAIS rejeté pour un stock devenu insuffisant pendant la coupure —
  -- la vente a eu lieu, le stock peut passer négatif ; l'écart est tracé dans
  -- audit_logs (metadata offline_replay: true, ci-dessous).
  IF p_offline_replay THEN
    v_allow_negative := true;
  END IF;

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

  SELECT s.tax_amount, s.total
    INTO v_tax_amount, v_total
    FROM _pb1_split_v1(v_total) s;

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
        -- ADR-013 D9 : gate PIN nonce actif hors replay offline.
        'pin_gated',             (NOT p_offline_replay),
        'offline_replay',        p_offline_replay,
        'rpc_version',           'v14-adr013-d9'
      ));
  END IF;

  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    FOR v_promo IN SELECT * FROM jsonb_array_elements(p_promotions) LOOP
      v_promo_id := (v_promo->>'promotion_id')::UUID;

      -- S57 guardian fix (_096) : re-check atomique des plafonds au moment de
      -- l'INSERT, sous advisory lock — miroir exact du gate dur de
      -- complete_order_with_payment_v17 (_092).
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
        p_order_id,
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
      -- A4 : marquage du replay d'une vente encaissée hors-ligne.
      'offline_replay',  p_offline_replay,
      'rpc_version',     'v14-adr013-d9'
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

-- RPC versioning monotone : DROP de v13 dans la même migration.
DROP FUNCTION IF EXISTS public.pay_existing_order_v13(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb, boolean);

-- ACL défense-en-profondeur (anon hérite EXECUTE via PUBLIC — REVOKE des deux).
REVOKE ALL ON FUNCTION public.pay_existing_order_v14(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, uuid, jsonb, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_existing_order_v14(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, uuid, jsonb, jsonb, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_existing_order_v14(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, uuid, jsonb, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_existing_order_v14(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, uuid, jsonb, jsonb, boolean) TO service_role;
