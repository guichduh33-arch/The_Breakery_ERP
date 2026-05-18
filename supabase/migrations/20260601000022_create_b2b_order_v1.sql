-- 20260601000022_create_b2b_order_v1.sql
-- Session 24 / Phase 1.A.2 / migration 11
--
-- create_b2b_order_v1 : crée une commande B2B "credit-style" (unpaid à la
-- création — paiement enregistré ultérieurement via record_b2b_payment_v1).
--
-- Différence avec complete_order_with_payment_v9 (POS path) :
--   - session_id = NULL (commande créée depuis le BO, pas depuis le POS)
--   - status = 'b2b_pending' (pas 'paid')
--   - paid_at = NULL
--   - PAS de paiement immédiat (pas de order_payments rows)
--   - JE : DR B2B_AR (1132) / CR SALE_B2B_REVENUE (4131)
--   - Pas de PB1 (Indonésie B2B typiquement sans PB1 — pre-flight §5
--     décision PKP à confirmer S30)
--   - Pas de loyalty earn (B2B hors programme loyalty retail)
--   - Pas de promotions (B2B avec listes négociées = backlog S25+)
--
-- Gate crédit obligatoire : appelle validate_b2b_credit_limit_v1 et raise
-- 'credit_limit_exceeded' (P0011) avec DETAIL=payload JSONB si allowed=false.
--
-- Décrément stock identique au POS (INSERT stock_movements movement_type='sale',
-- UPDATE products.current_stock) — pas via record_stock_movement_v1 car ce
-- primitive expose unit_cost/section_id non utilisés ici, et le pattern
-- complete_order_v9 fait l'INSERT direct.

CREATE OR REPLACE FUNCTION create_b2b_order_v1(
  p_customer_id    UUID,
  p_items          JSONB,
  p_notes          TEXT  DEFAULT NULL,
  p_delivery_date  DATE  DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
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
BEGIN
  -- 1) Auth + profile + permission
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

  -- 2) Idempotency replay
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

  -- 3) Validate inputs
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

  -- 4) Lock products + compute items_total + check stock
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
    IF v_product.current_stock < v_quantity THEN
      RAISE EXCEPTION 'insufficient_stock for product % (have %, need %)',
        v_product.name, v_product.current_stock, v_quantity
        USING ERRCODE = 'P0002';
    END IF;

    v_line_total  := round_idr(v_unit_price * v_quantity);
    v_items_total := v_items_total + v_line_total;
  END LOOP;

  IF v_items_total <= 0 THEN
    RAISE EXCEPTION 'invalid_total' USING ERRCODE = 'P0001';
  END IF;

  -- 5) Gate crédit (S24 cœur de mission) — appelle l'existant
  v_credit_check := validate_b2b_credit_limit_v1(p_customer_id, v_items_total);
  IF (v_credit_check->>'allowed')::boolean = FALSE THEN
    RAISE EXCEPTION 'credit_limit_exceeded: %', v_credit_check::text
      USING ERRCODE = 'P0011',
            DETAIL  = v_credit_check::text;
  END IF;

  -- 6) Fiscal period guard
  PERFORM check_fiscal_period_open(v_now::date);

  -- 7) Generate order_number via order_sequences (même pattern POS)
  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := 'B2B-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
                    LPAD(v_seq_number::text, 4, '0');

  -- 8) Lock customer + snapshot balance
  SELECT b2b_current_balance INTO v_balance_before
    FROM customers
   WHERE id = p_customer_id
   FOR UPDATE;

  v_balance_before := COALESCE(v_balance_before, 0);
  v_balance_after  := v_balance_before + v_items_total;

  -- 9) INSERT orders (session_id=NULL, status='b2b_pending', paid_at=NULL)
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total,
    customer_id, idempotency_key, paid_at, created_at
  ) VALUES (
    v_order_number, NULL, v_profile_id, 'b2b', 'b2b_pending',
    v_items_total, 0, v_items_total,
    p_customer_id, p_idempotency_key, NULL, v_now
  ) RETURNING id INTO v_order_id;

  -- 10) Items loop : INSERT order_items + stock_movements + UPDATE products
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

    INSERT INTO stock_movements (
      product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
    )
    SELECT
      v_product_id, 'sale', -v_quantity, COALESCE(p.unit, 'pcs'),
      'orders', v_order_id, v_profile_id
    FROM products p WHERE p.id = v_product_id;

    UPDATE products
       SET current_stock = current_stock - v_quantity,
           updated_at    = now()
     WHERE id = v_product_id;
  END LOOP;

  -- 11) JE : DR B2B_AR / CR SALE_B2B_REVENUE (pas de PB1 — B2B hors scope)
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

  -- 12) UPDATE customers.b2b_current_balance += total (bypass REVOKE via DEFINER)
  UPDATE customers
     SET b2b_current_balance = v_balance_after,
         updated_at = now()
   WHERE id = p_customer_id;

  -- 13) Audit log
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
      'rpc_version',    'v1'
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
END $func$;

REVOKE EXECUTE ON FUNCTION create_b2b_order_v1(UUID, JSONB, TEXT, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_b2b_order_v1(UUID, JSONB, TEXT, DATE, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION create_b2b_order_v1(UUID, JSONB, TEXT, DATE, UUID) TO authenticated;

COMMENT ON FUNCTION create_b2b_order_v1(UUID, JSONB, TEXT, DATE, UUID) IS
  'S24 — Crée une commande B2B credit-style (status=b2b_pending, paid_at=NULL, '
  'session_id=NULL). Câble validate_b2b_credit_limit_v1 comme gate pre-insert. '
  'JE : DR B2B_AR (1132) / CR SALE_B2B_REVENUE (4131) ; pas de PB1 (B2B hors '
  'scope PKP — pre-flight §5, à reconsidérer S30). Décrément stock identique '
  'à complete_order_v9 (INSERT stock_movements movement_type=sale + UPDATE '
  'products.current_stock). Idempotent via p_idempotency_key (orders.UNIQUE). '
  'Errors : P0001 not_authenticated/invalid_quantity/invalid_unit_price/'
  'invalid_total/items_required/customer_not_b2b, P0002 customer_not_found/'
  'product_not_found/insufficient_stock, P0003 permission_denied, P0004 '
  'fiscal_period_closed, P0011 credit_limit_exceeded (DETAIL=payload JSONB).';
