-- S50 Vague 2a-i · T4 — create_b2b_order : stock flag-aware (fix N1)
--
-- BUG N1 : le guard « IF v_product.current_stock < v_quantity THEN insufficient_stock »
-- était INCONDITIONNEL — il ignorait track_inventory ET allow_negative ET ne consommait
-- jamais de recette. Conséquence : tout produit non-tracké (café / recette, current_stock=0)
-- était INVENDABLE en B2B, alors qu'il se vend sans souci au POS (v14).
--
-- Fix (parité v14) : guard + déduction conditionnés sur track_inventory / deduct_stock /
-- allow_negative. Produit tracké → check + décrément du stock fini. Produit deduct_stock →
-- consommation des matières recette via _resolve_recipe_consumption_v1 (mirror v14). Ni l'un
-- ni l'autre → vendable sans mouvement (service). Signature + retour inchangés → CREATE OR
-- REPLACE en place (bugfix, aucun appelant ne veut l'ancien comportement cassé).

CREATE OR REPLACE FUNCTION public.create_b2b_order_v1(p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_delivery_date date DEFAULT NULL::date, p_idempotency_key uuid DEFAULT NULL::uuid)
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
  -- flag-aware stock (S50 V2a-i T4)
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

  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'permission_denied: pos.sale.create' USING ERRCODE = 'P0003';
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

  -- Politique stock négatif (statu quo projet : DEFAULT true)
  v_allow_negative := COALESCE((SELECT allow_negative_stock FROM business_config LIMIT 1), TRUE);

  -- Validation des lignes + guard stock flag-aware (mirror v14)
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
    v_unit_price := (v_item->>'unit_price')::numeric;

    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid_quantity for product %', v_product.name
        USING ERRCODE = 'P0001';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'invalid_unit_price for product %', v_product.name
        USING ERRCODE = 'P0001';
    END IF;

    -- Guard stock : seulement si négatif interdit, et selon les flags.
    IF NOT v_allow_negative THEN
      IF v_product.track_inventory THEN
        IF v_product.current_stock < v_quantity THEN
          RAISE EXCEPTION 'insufficient_stock for product % (have %, need %)',
            v_product.name, v_product.current_stock, v_quantity
            USING ERRCODE = 'P0002';
        END IF;
      ELSIF v_product.deduct_stock THEN
        FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_product.id, v_quantity) LOOP
          SELECT current_stock INTO v_cons_stock FROM products WHERE id = v_cons.product_id;
          IF COALESCE(v_cons_stock, 0) < v_cons.qty_base THEN
            RAISE EXCEPTION 'insufficient_stock for recipe material of % (need %)',
              v_product.name, v_cons.qty_base
              USING ERRCODE = 'P0002';
          END IF;
        END LOOP;
      END IF;
      -- ni tracké ni deduct_stock → pas de contrainte
    END IF;

    v_line_total  := round_idr(v_unit_price * v_quantity);
    v_items_total := v_items_total + v_line_total;
  END LOOP;

  IF v_items_total <= 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = 'P0001';
  END IF;

  v_credit_check := validate_b2b_credit_limit_v1(p_customer_id, v_items_total);
  IF (v_credit_check->>'allowed')::boolean = FALSE THEN
    RAISE EXCEPTION 'credit_limit_exceeded: %', v_credit_check::text
      USING ERRCODE = 'P0011',
            DETAIL  = v_credit_check::text;
  END IF;

  PERFORM check_fiscal_period_open(v_now::date);

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := 'B2B-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
                    LPAD(v_seq_number::text, 4, '0');

  SELECT b2b_current_balance INTO v_balance_before
    FROM customers
   WHERE id = p_customer_id
   FOR UPDATE;

  v_balance_before := COALESCE(v_balance_before, 0);
  v_balance_after  := v_balance_before + v_items_total;

  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total,
    customer_id, idempotency_key, paid_at, created_at
  ) VALUES (
    v_order_number, NULL, v_profile_id, 'b2b', 'b2b_pending',
    v_items_total, 0, v_items_total,
    p_customer_id, p_idempotency_key, NULL, v_now
  ) RETURNING id INTO v_order_id;

  -- Lignes + déduction stock flag-aware
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
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
      INSERT INTO stock_movements (
        product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
      ) VALUES (
        v_product_id, 'sale', -v_quantity, COALESCE(v_line_unit, 'pcs'),
        'orders', v_order_id, v_profile_id
      );
      UPDATE products
         SET current_stock = current_stock - v_quantity,
             updated_at    = now()
       WHERE id = v_product_id;
    ELSIF v_line_deduct THEN
      FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_product_id, v_quantity) LOOP
        INSERT INTO stock_movements (
          product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
        ) VALUES (
          v_cons.product_id, 'sale', -v_cons.qty_base, COALESCE(v_cons.unit, 'pcs'),
          'orders', v_order_id, v_profile_id
        );
        UPDATE products
           SET current_stock = current_stock - v_cons.qty_base,
               updated_at    = now()
         WHERE id = v_cons.product_id;
      END LOOP;
    END IF;
    -- ni tracké ni deduct_stock → aucun mouvement
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

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile_id, 'b2b.order.created', 'orders', v_order_id,
    jsonb_build_object(
      'order_number',   v_order_number,
      'customer_id',    p_customer_id,
      'items_total',    v_items_total,
      'balance_before', v_balance_before,
      'balance_after',  v_balance_after,
      'credit_check',   v_credit_check,
      'je_id',          v_je_id,
      'delivery_date',  p_delivery_date,
      'rpc_version',    'v1-flagaware-s50'
    )
  );

  RETURN jsonb_build_object(
    'order_id',          v_order_id,
    'order_number',      v_order_number,
    'total',             v_items_total,
    'credit_after',      v_balance_after,
    'je_id',             v_je_id,
    'idempotent_replay', FALSE
  );
END $function$;
