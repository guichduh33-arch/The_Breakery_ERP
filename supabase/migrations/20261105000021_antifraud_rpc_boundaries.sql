-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_payments_by_method_v4(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_tz            TEXT;
  v_start         TIMESTAMPTZ;
  v_end           TIMESTAMPTZ;
  v_total_amount  NUMERIC(15,2);
  v_total_count   INT;
  v_total_orders  INT;
  v_fees          JSONB;
  v_total_fees    NUMERIC(15,2);
  v_by_method     JSONB;
  v_by_day        JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  -- Lot C : frais informatifs par méthode ({"<method>": <percent>}).
  SELECT payment_method_fees INTO v_fees
    FROM business_config WHERE id = 1;
  v_fees := COALESCE(v_fees, '{}'::jsonb);

  -- Local calendar-day bounds converted back to an absolute instant range,
  -- so the BETWEEN below still short-circuits on the paid_at index.
  v_start := (p_date_start || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end   := ((p_date_end::date + 1) || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at,
           ((op.paid_at AT TIME ZONE v_tz))::date AS local_day
    FROM reporting_private.closed_order_payments_v1 op
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(SUM(amount), 0), COUNT(*), COUNT(DISTINCT order_id)
  INTO v_total_amount, v_total_count, v_total_orders
  FROM valid_payments;

  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at,
           ((op.paid_at AT TIME ZONE v_tz))::date AS local_day
    FROM reporting_private.closed_order_payments_v1 op
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.amount DESC), '[]'::jsonb)
  INTO v_by_method
  FROM (
    SELECT
      method::text AS method,
      SUM(amount)  AS amount,
      COUNT(*)     AS count,
      CASE WHEN v_total_amount = 0 THEN 0
           ELSE ROUND((SUM(amount) / v_total_amount) * 100, 2)
      END AS share_pct,
      COALESCE((v_fees ->> method::text)::NUMERIC, 0) AS fee_pct,
      ROUND(SUM(amount) * COALESCE((v_fees ->> method::text)::NUMERIC, 0) / 100, 2) AS fee_est,
      SUM(amount)
        - ROUND(SUM(amount) * COALESCE((v_fees ->> method::text)::NUMERIC, 0) / 100, 2) AS net_est
    FROM valid_payments
    GROUP BY method
  ) t;

  SELECT COALESCE(SUM((e ->> 'fee_est')::NUMERIC), 0) INTO v_total_fees
  FROM jsonb_array_elements(v_by_method) e;

  -- by_day pivot — 9 named methods + `other` (catch-all) so columns reconcile to total.
  -- day = LOCAL calendar day (business_config.timezone), not UTC.
  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at,
           ((op.paid_at AT TIME ZONE v_tz))::date AS local_day
    FROM reporting_private.closed_order_payments_v1 op
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      local_day AS day,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'cash'),         0) AS cash,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'card'),         0) AS card,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'qris'),         0) AS qris,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'edc'),          0) AS edc,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'transfer'),     0) AS transfer,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'store_credit'), 0) AS store_credit,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'gopay'),        0) AS gopay,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'ovo'),          0) AS ovo,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'dana'),         0) AS dana,
      COALESCE(SUM(amount) FILTER (WHERE method::text NOT IN
        ('cash','card','qris','edc','transfer','store_credit','gopay','ovo','dana')), 0) AS other,
      SUM(amount) AS total
    FROM valid_payments
    GROUP BY local_day
  ) t;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'summary', jsonb_build_object(
      'total_amount',   v_total_amount,
      'total_count',    v_total_count,
      'total_orders',   v_total_orders,
      'total_fees_est', v_total_fees,
      'total_net_est',  v_total_amount - v_total_fees
    ),
    'by_method', v_by_method,
    'by_day',    v_by_day
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_payments_by_method_v4(p_date_start text, p_date_end text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_payments_by_method_v4(p_date_start text, p_date_end text) TO authenticated,service_role;
DROP FUNCTION public.get_payments_by_method_v3(p_date_start text, p_date_end text);

CREATE OR REPLACE FUNCTION public.complete_order_with_payment_v32(p_session_id uuid, p_order_type order_type, p_items jsonb, p_payment jsonb DEFAULT NULL::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_loyalty_points_redeemed integer DEFAULT 0, p_table_number text DEFAULT NULL::text, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT NULL::text, p_discount_value numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_promotions jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT NULL::jsonb, p_discount_auth_id uuid DEFAULT NULL::uuid, p_source_code text DEFAULT 'P'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 RETURN stock_private.mask_stock_payload(stock_private.complete_order_with_payment_v30(p_session_id,p_order_type,p_items,p_payment,p_idempotency_key,p_customer_id,p_loyalty_points_redeemed,p_table_number,p_discount_amount,p_discount_type,p_discount_value,p_discount_reason,p_discount_authorized_by,p_promotions,p_payments,p_discount_auth_id,p_source_code));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date) AND SQLSTATE='P0002'
    AND SQLERRM ~* '(insufficient.*stock|have )'
 THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002'; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.complete_order_with_payment_v32(p_session_id uuid, p_order_type order_type, p_items jsonb, p_payment jsonb, p_idempotency_key uuid, p_customer_id uuid, p_loyalty_points_redeemed integer, p_table_number text, p_discount_amount numeric, p_discount_type text, p_discount_value numeric, p_discount_reason text, p_discount_authorized_by uuid, p_promotions jsonb, p_payments jsonb, p_discount_auth_id uuid, p_source_code text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v32(p_session_id uuid, p_order_type order_type, p_items jsonb, p_payment jsonb, p_idempotency_key uuid, p_customer_id uuid, p_loyalty_points_redeemed integer, p_table_number text, p_discount_amount numeric, p_discount_type text, p_discount_value numeric, p_discount_reason text, p_discount_authorized_by uuid, p_promotions jsonb, p_payments jsonb, p_discount_auth_id uuid, p_source_code text) TO authenticated,service_role;
DROP FUNCTION public.complete_order_with_payment_v31(p_session_id uuid, p_order_type order_type, p_items jsonb, p_payment jsonb, p_idempotency_key uuid, p_customer_id uuid, p_loyalty_points_redeemed integer, p_table_number text, p_discount_amount numeric, p_discount_type text, p_discount_value numeric, p_discount_reason text, p_discount_authorized_by uuid, p_promotions jsonb, p_payments jsonb, p_discount_auth_id uuid, p_source_code text);

CREATE OR REPLACE FUNCTION stock_private.create_b2b_order_v9(p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_delivery_date date DEFAULT NULL::date, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid               UUID := auth.uid();
  v_profile_id        UUID;
  v_customer_type     customer_type;
  v_balance_before    NUMERIC(14,2);
  v_balance_after     NUMERIC(14,2);
  v_existing_id       UUID;
  v_order_id          UUID;
  v_order_number      TEXT;
  v_invoice_number    TEXT;
  v_seq_number        INTEGER;
  v_items_total       NUMERIC(14,2) := 0;
  v_item              JSONB;
  v_product           RECORD;
  v_product_id        UUID;
  v_quantity          NUMERIC(10,3);
  v_unit_price        NUMERIC(14,2);
  v_line_total        NUMERIC(14,2);
  v_credit_check      JSONB;
  v_je_id             UUID;
  v_entry_no          TEXT;
  v_ar_id             UUID;
  v_revenue_id        UUID;
  v_now               TIMESTAMPTZ := now();
  v_allow_negative    BOOLEAN;
  v_cons              RECORD;
  v_cons_stock        NUMERIC(14,3);
  v_line_track        BOOLEAN;
  v_line_deduct       BOOLEAN;
  v_line_unit         TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'b2b.order.create') THEN
    RAISE EXCEPTION 'permission_denied: b2b.order.create' USING ERRCODE = 'P0003';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM orders
     WHERE idempotency_key = p_idempotency_key
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN (
        SELECT jsonb_build_object(
          'order_id',          o.id,
          'order_number',      o.order_number,
          'invoice_number',    o.invoice_number,
          'total',             o.total,
          'credit_after',      c.b2b_current_balance,
          'je_id',             (SELECT id FROM journal_entries
                                 WHERE reference_type = 'b2b_order'
                                   AND reference_id   = o.id LIMIT 1),
          'idempotent_replay', TRUE
        )
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        WHERE o.id = v_existing_id
      );
    END IF;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT customer_type INTO v_customer_type
    FROM customers
   WHERE id = p_customer_id AND deleted_at IS NULL
   LIMIT 1;

  IF v_customer_type IS NULL THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_customer_type <> 'b2b' THEN
    RAISE EXCEPTION 'customer_not_b2b' USING ERRCODE = 'P0001';
  END IF;

  v_allow_negative := COALESCE((SELECT allow_negative_stock FROM business_config LIMIT 1), TRUE);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_product
      FROM products
     WHERE id = (v_item->>'product_id')::uuid
     FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'product_not_found: %', v_item->>'product_id'
        USING ERRCODE = 'P0002';
    END IF;

    v_quantity   := (v_item->>'quantity')::numeric;
    -- S69: server resolves the line price (negotiated > category > retail); client value ignored.
    v_unit_price := _resolve_b2b_line_price_v1(p_customer_id, v_product.id);

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid_quantity for product %', v_product.name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'price_unresolved for product %', v_product.name
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_allow_negative THEN
      IF v_product.track_inventory THEN
        IF v_product.current_stock < v_quantity THEN
          RAISE EXCEPTION 'insufficient_stock for product % (have %, need %)',
            v_product.name, v_product.current_stock, v_quantity
            USING ERRCODE = 'P0002';
        END IF;
      ELSIF v_product.deduct_stock THEN
        FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v2(v_product.id, v_quantity) LOOP
          SELECT current_stock INTO v_cons_stock FROM products WHERE id = v_cons.product_id;
          IF COALESCE(v_cons_stock, 0) < v_cons.qty_base THEN
            RAISE EXCEPTION 'insufficient_stock for recipe material of % (need %)',
              v_product.name, v_cons.qty_base
              USING ERRCODE = 'P0002';
          END IF;
        END LOOP;
      END IF;
    END IF;

    v_line_total  := round_idr(v_unit_price * v_quantity);
    v_items_total := v_items_total + v_line_total;
  END LOOP;

  IF v_items_total <= 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = 'P0001';
  END IF;

  PERFORM check_fiscal_period_open(v_now::date);

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  -- Numérotation par origine : BO<DDMMYYYY><NNN>, séquence quotidienne partagée
  -- entre toutes les portes. La référence de facturation reste invoice_number.
  v_order_number := 'BO' || to_char(CURRENT_DATE, 'DDMMYYYY') || LPAD(v_seq_number::text, 3, '0');

  SELECT b2b_current_balance INTO v_balance_before
    FROM customers
   WHERE id = p_customer_id
   FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before, 0);

  v_credit_check := validate_b2b_credit_limit_v1(p_customer_id, v_items_total);
  IF (v_credit_check->>'allowed')::boolean = FALSE THEN
    RAISE EXCEPTION 'credit_limit_exceeded: %', v_credit_check::text
      USING ERRCODE = 'P0011',
            DETAIL  = v_credit_check::text;
  END IF;

  v_balance_after  := v_balance_before + v_items_total;

  v_invoice_number := _next_b2b_invoice_number_v1();

  -- 2026-09-08 (finding n°4) : `pickup_date` et `notes` sont enfin écrits. NULLIF(trim())
  -- pour ne pas stocker une chaîne vide quand l'opérateur laisse le champ intact.
  INSERT INTO orders (
    order_number, invoice_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total,
    customer_id, idempotency_key, paid_at, created_at,
    pickup_date, notes
  ) VALUES (
    v_order_number, v_invoice_number, NULL, v_profile_id, 'b2b', 'b2b_pending',
    v_items_total, 0, v_items_total,
    p_customer_id, p_idempotency_key, NULL, v_now,
    p_delivery_date, NULLIF(trim(COALESCE(p_notes, '')), '')
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::numeric;
    -- S69: same server-resolved price used for the recorded line.
    v_unit_price := _resolve_b2b_line_price_v1(p_customer_id, v_product_id);
    v_line_total := round_idr(v_unit_price * v_quantity);

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total
    FROM products p WHERE p.id = v_product_id;

    SELECT track_inventory, deduct_stock, unit
      INTO v_line_track, v_line_deduct, v_line_unit
      FROM products WHERE id = v_product_id;

    IF v_line_track THEN
      PERFORM _record_sale_stock_v1(
        p_product_id     := v_product_id,
        p_quantity       := v_quantity,
        p_reference_id   := v_order_id,
        p_created_by     := v_profile_id,
        p_reason         := 'B2B sale',
        p_unit           := v_line_unit,
        p_allow_negative := v_allow_negative
      );
    ELSIF v_line_deduct THEN
      FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v2(v_product_id, v_quantity) LOOP
        PERFORM _record_sale_stock_v1(
          p_product_id     := v_cons.product_id,
          p_quantity       := v_cons.qty_base,
          p_reference_id   := v_order_id,
          p_created_by     := v_profile_id,
          p_reason         := 'B2B recipe consumption',
          p_unit           := v_cons.unit,
          p_allow_negative := v_allow_negative
        );
      END LOOP;
    END IF;
  END LOOP;

  v_ar_id      := resolve_mapping_account('B2B_AR');
  v_revenue_id := resolve_mapping_account('SALE_B2B_REVENUE');
  v_entry_no   := next_journal_entry_number(v_now::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, v_now::date,
    'B2B order ' || v_order_number, 'b2b_order', v_order_id,
    'posted', v_items_total, v_items_total, v_profile_id
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_ar_id,      v_items_total, 0, 'B2B AR — invoice ' || v_order_number),
    (v_je_id, v_revenue_id, 0, v_items_total, 'B2B revenue — ' || v_order_number);

  UPDATE customers
     SET b2b_current_balance = v_balance_after,
         updated_at = now()
   WHERE id = p_customer_id;

  UPDATE public.orders SET recipe_consumption_revision=2 WHERE id=v_order_id;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.order.created', 'orders', v_order_id,
    jsonb_build_object(
      'order_number',   v_order_number,
      'invoice_number', v_invoice_number,
      'customer_id',    p_customer_id,
      'items_total',    v_items_total,
      'balance_before', v_balance_before,
      'balance_after',  v_balance_after,
      'credit_check',   v_credit_check,
      'je_id',          v_je_id,
      'delivery_date',  p_delivery_date,
      'rpc_version',    'v8-recipe-units'
    )
  );

  RETURN jsonb_build_object(
    'order_id',          v_order_id,
    'order_number',      v_order_number,
    'invoice_number',    v_invoice_number,
    'total',             v_items_total,
    'credit_after',      v_balance_after,
    'je_id',             v_je_id,
    'idempotent_replay', FALSE
  );
END $function$
;
REVOKE ALL ON FUNCTION stock_private.create_b2b_order_v9(p_customer_id uuid, p_items jsonb, p_notes text, p_delivery_date date, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
DROP FUNCTION stock_private.create_b2b_order_v8(p_customer_id uuid, p_items jsonb, p_notes text, p_delivery_date date, p_idempotency_key uuid);

CREATE OR REPLACE FUNCTION public.create_b2b_order_v10(p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_delivery_date date DEFAULT NULL::date, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 RETURN stock_private.mask_stock_payload(stock_private.create_b2b_order_v9(p_customer_id,p_items,p_notes,p_delivery_date,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date) AND SQLSTATE='P0002'
    AND SQLERRM ~* '(insufficient.*stock|have )'
 THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002'; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.create_b2b_order_v10(p_customer_id uuid, p_items jsonb, p_notes text, p_delivery_date date, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_b2b_order_v10(p_customer_id uuid, p_items jsonb, p_notes text, p_delivery_date date, p_idempotency_key uuid) TO authenticated,service_role;
DROP FUNCTION public.create_b2b_order_v9(p_customer_id uuid, p_items jsonb, p_notes text, p_delivery_date date, p_idempotency_key uuid);
