-- 20260628000012_bump_complete_order_v12.sql
-- Session 44 / Wave B / P0-A(a) + P0-C(1,2,4) + OPP-1.
-- v11 → v12 :
--   1. P0-A : INSERT orders en 'pending_payment' (paid_at NULL) ; status='paid'
--      + paid_at posés par un UPDATE FINAL après les inserts order_payments →
--      le trigger JE voit les payments et split par méthode (sinon fallback cash à 100 %).
--      Le bloc "loyalty JE append" (redemption, lit la JE 'sale') migre APRÈS cet UPDATE.
--   2. P0-C(1) : montant promo recalculé via evaluate_promotions_v1 — mismatch = reject.
--      Le subtotal d'éval est calculé EXACTEMENT comme le client (somme non-gift
--      unit_price*qty, sans modifiers ni remise ligne) — DEV-S44-B1-01 : le plan
--      passait v_items_total, qui inclut modifiers et déduit les remises ligne →
--      aurait causé des faux rejets sur tout panier remisé/à modifiers.
--   3. P0-C(2) : p_loyalty_multiplier SUPPRIMÉ de la signature ; multiplier résolu
--      via get_loyalty_multiplier(lifetime_points) × customer_categories.points_multiplier.
--   4. P0-C(4) : change_given revalidé (cash : = cash_received - amount ; non-cash : 0).
--   5. OPP-1 : enveloppe replay reconstruit change_given + loyalty_points_earned.
-- Versioning monotone : DROP v11 dans la même migration.

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'complete_order_with_payment_v11' AND pronamespace = 'public'::regnamespace
  LOOP EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE'; END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION public.complete_order_with_payment_v12(
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
  p_manager_pin text DEFAULT NULL::text
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
  -- S37 SEC-01/02
  v_has_discount         BOOLEAN := false;
  v_authorizer_uid       UUID;
  v_price_overrides      JSONB := '[]'::jsonb;
  v_loyalty_balance_after INTEGER;
  -- S44 P0-C
  v_loyalty_multiplier   NUMERIC := 1.0;
  v_server_eval          JSONB;
  v_server_amount        DECIMAL(14,2);
  v_eval_items           JSONB;
  v_eval_subtotal        DECIMAL(14,2) := 0;
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
      -- S44 OPP-1 : enveloppe de replay honnête (change_given + points réels).
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

  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  v_items_total := 0;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product FROM products
      WHERE id = (v_item->>'product_id')::UUID
      FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Product not found: %', v_item->>'product_id' USING ERRCODE = 'P0002';
    END IF;

    v_quantity := (v_item->>'quantity')::DECIMAL;

    IF v_product.is_display_item THEN
      IF COALESCE((SELECT quantity FROM display_stock WHERE product_id = v_product.id), 0) < v_quantity THEN
        RAISE EXCEPTION 'Insufficient display stock for product % (need %)',
          v_product.name, v_quantity
          USING ERRCODE = 'P0002';
      END IF;
    ELSE
      IF v_product.current_stock < v_quantity THEN
        RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
          v_product.name, v_product.current_stock, v_quantity
          USING ERRCODE = 'P0002';
      END IF;
    END IF;

    v_unit_price    := (v_item->>'unit_price')::DECIMAL;
    v_item_is_gift  := COALESCE((v_item->>'is_promo_gift')::BOOLEAN, false);
    v_item_promo_id := NULLIF(v_item->>'promotion_id', '')::UUID;

    -- S37 SEC-02 : réconciliation du prix client contre le prix server-side
    -- canonique (catégorie client incluse). Gift lines exemptées UNIQUEMENT si
    -- leur promotion_id figure dans p_promotions.
    IF v_item_is_gift AND (v_item_promo_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(p_promotions, '[]'::jsonb)) e
      WHERE (e->>'promotion_id')::uuid = v_item_promo_id
    )) THEN
      RAISE EXCEPTION 'Gift line requires a matching declared promotion'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_item_is_gift THEN
      v_expected_price := get_customer_product_price(v_product.id, p_customer_id);
      IF v_unit_price IS DISTINCT FROM v_expected_price THEN
        v_price_overrides := v_price_overrides || jsonb_build_object(
          'product_id',          v_product.id,
          'client_unit_price',   v_unit_price,
          'expected_unit_price', v_expected_price
        );
        v_unit_price := v_expected_price;
      END IF;
      -- S44 P0-C(1) : subtotal d'évaluation promo = somme non-gift unit_price*qty
      -- (prix réconcilié), SANS modifiers ni remise ligne — mirroir exact du
      -- subtotal calculé client-side dans useEvaluatePromotions.
      v_eval_subtotal := v_eval_subtotal + round_idr(v_unit_price * v_quantity);
    END IF;

    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(14,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_line_discount := COALESCE((v_item->>'discount_amount')::DECIMAL(14,2), 0);
    IF v_line_discount > 0 THEN
      v_has_discount := true;
    END IF;
    v_line_total    := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity) - v_line_discount;
    v_items_total   := v_items_total + v_line_total;
  END LOOP;

  -- S37 SEC-01 : gate d'autorité sur tout discount (order-level OU line-level).
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
    IF p_manager_pin IS NULL OR NOT _verify_pin_with_lockout(p_discount_authorized_by, p_manager_pin) THEN
      RAISE EXCEPTION 'Invalid manager PIN for discount authorization' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  IF p_promotions IS NOT NULL AND jsonb_array_length(p_promotions) > 0 THEN
    v_now_dow  := EXTRACT(ISODOW FROM v_now)::INTEGER;
    v_now_hour := EXTRACT(HOUR  FROM v_now)::INTEGER;

    IF p_customer_id IS NOT NULL THEN
      SELECT category_id INTO v_customer_category_id
        FROM customers WHERE id = p_customer_id;
    END IF;

    -- S44 P0-C(1) : ré-évaluation serveur avec le MÊME payload que le client
    -- (useEvaluatePromotions : non-gift lines + subtotal brut). Chaque promo
    -- client est ensuite matchée par promotion_id contre le montant serveur.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'product_id', item->>'product_id',
             'quantity',   (item->>'quantity')::numeric,
             'unit_price', (item->>'unit_price')::numeric)), '[]'::jsonb)
      INTO v_eval_items
      FROM jsonb_array_elements(p_items) AS item
      WHERE COALESCE((item->>'is_promo_gift')::boolean, false) = false;

    v_server_eval := evaluate_promotions_v1(
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

      -- S44 P0-C(1) : le montant client doit égaler le montant ré-évalué serveur.
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

    -- S44 P0-C(4) : le change n'est plus une valeur de confiance.
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

  -- S44 P0-A(a) : INSERT en 'pending_payment' (paid_at NULL). Le trigger JE ne
  -- fire PAS ici (WHEN status='paid'). Le statut paid est posé en DERNIER, après
  -- les inserts order_payments, pour que le split par méthode voie les payments.
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

  -- S37 SEC-05 : trace d'audit dédiée au discount autorisé.
  IF v_has_discount THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.discount_applied', 'orders', v_order_id, jsonb_build_object(
        'order_number',          v_order_number,
        'order_discount_amount', p_discount_amount,
        'discount_type',         p_discount_type,
        'discount_value',        p_discount_value,
        'discount_reason',       p_discount_reason,
        'authorized_by',         p_discount_authorized_by,
        'rpc_version',           'v12'
      ));
  END IF;

  -- S37 SEC-02 : trace d'audit des prix client écartés au profit du prix serveur.
  IF jsonb_array_length(v_price_overrides) > 0 THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_profile_id, 'order.price_overridden', 'orders', v_order_id, jsonb_build_object(
        'order_number', v_order_number,
        'overrides',    v_price_overrides,
        'rpc_version',  'v12'
      ));
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_item_is_gift  := COALESCE((v_item->>'is_promo_gift')::BOOLEAN, false);
    v_item_promo_id := NULLIF(v_item->>'promotion_id', '')::UUID;

    -- S37 SEC-02 : même réconciliation que la passe de totaux (déterministe).
    IF NOT v_item_is_gift THEN
      v_expected_price := get_customer_product_price(v_product_id, p_customer_id);
      IF v_unit_price IS DISTINCT FROM v_expected_price THEN
        v_unit_price := v_expected_price;
      END IF;
    END IF;

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
      product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
    )
    SELECT
      v_product_id, 'sale', -v_quantity, COALESCE(p.unit, 'pcs'),
      'orders', v_order_id, v_profile_id
    FROM products p WHERE p.id = v_product_id;

    UPDATE products
      SET current_stock = current_stock - v_quantity,
          updated_at = now()
      WHERE id = v_product_id;

    IF (SELECT is_display_item FROM products WHERE id = v_product_id) THEN
      INSERT INTO display_movements (
        product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
      ) VALUES (
        v_product_id, 'sale', -v_quantity, 'POS sale', 'order', v_order_id, v_profile_id
      );
      UPDATE display_stock
        SET quantity = quantity - v_quantity,
            updated_at = now()
        WHERE product_id = v_product_id;
    END IF;
  END LOOP;

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

  -- S44 P0-A(a) : statut paid posé EN DERNIER → trg_create_sale_journal_entry_upd
  -- split la JE par méthode réelle (les order_payments existent désormais).
  UPDATE orders SET status = 'paid', paid_at = now(), updated_at = now()
    WHERE id = v_order_id;

  -- (bloc loyalty JE append — il lit la JE 'sale' créée par le trigger ci-dessus)
  IF v_redemption_amount > 0 THEN
    SELECT id INTO v_je_id
      FROM journal_entries
      WHERE reference_type = 'sale' AND reference_id = v_order_id;

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
      p_customer_id, v_order_id, 'redeem', -p_loyalty_points_redeemed,
      v_loyalty_balance - p_loyalty_points_redeemed,
      'Redemption on order ' || v_order_id::text, v_profile_id
    );
  END IF;

  IF p_customer_id IS NOT NULL AND v_total > 0 THEN
    -- S44 P0-C(2) : multiplier résolu server-side (tier lifetime_points × catégorie).
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

  -- S37 POS-04 : solde de points post-vente (NULL si pas de client attaché).
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
      'rpc_version',      'v12'
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
    'change_given',              v_total_change
  );
END $function$;

COMMENT ON FUNCTION public.complete_order_with_payment_v12(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text) IS
  'Session 44 v12. v11 → v12 : (1) P0-A status posé après order_payments → JE split par méthode réelle ; (2) P0-C montant promo ré-évalué server-side (mismatch=reject) ; (3) P0-C multiplier fidélité résolu en DB (plus de p_loyalty_multiplier) ; (4) P0-C change_given revalidé ; (5) OPP-1 enveloppe replay honnête. Voir docs/workplan S44.';
