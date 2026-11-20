-- S1-15 : corps live dev du 2026-11-20, création financière sans stock.
CREATE OR REPLACE FUNCTION public.create_b2b_order_v11(p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_delivery_date date DEFAULT NULL::date, p_idempotency_key uuid DEFAULT NULL::uuid)
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
    PERFORM pg_advisory_xact_lock(hashtextextended('b2b-create:'||p_idempotency_key::text,0));
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



  PERFORM id FROM public.customers WHERE id=p_customer_id FOR UPDATE;
  PERFORM p.id FROM public.products p WHERE p.id IN
    (SELECT (x->>'product_id')::uuid FROM jsonb_array_elements(p_items) x) ORDER BY p.id FOR UPDATE;
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

    IF v_quantity IS NULL OR v_quantity <= 0 OR v_quantity::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'invalid_quantity for product %', v_product.name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'price_unresolved for product %', v_product.name
        USING ERRCODE = 'P0002';
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
      'rpc_version',    'v11-stock-at-pickup'
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

REVOKE ALL ON FUNCTION public.create_b2b_order_v11(uuid,jsonb,text,date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_b2b_order_v11(uuid,jsonb,text,date,uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP FUNCTION public.create_b2b_order_v10(uuid,jsonb,text,date,uuid);
DROP FUNCTION stock_private.create_b2b_order_v9(uuid,jsonb,text,date,uuid);
