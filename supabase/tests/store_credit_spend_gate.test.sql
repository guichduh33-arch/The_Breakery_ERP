-- supabase/tests/store_credit_spend_gate.test.sql
-- ADR-013 Lot 4 (D8) — gate paiement par avoir dans complete_order_with_payment_v21 :
--   P0015 client requis, P0016 solde insuffisant (agrégé multi-tender, sous
--   verrou), débit ledger unique par commande, replay idempotent sans re-débit,
--   append-only du ledger + colonne cache verrouillée + CHECK >= 0.
-- Run via MCP execute_sql (BEGIN..ROLLBACK) ou API-from-file.

BEGIN;
SELECT plan(9);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_prod UUID; v_sess UUID;
  v_cust UUID; v_bal NUMERIC;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no user with pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, track_inventory, is_display_item)
    VALUES ('TST-SC-GATE', 'SC Gate Product', v_cat, 20000, 1000, true, false)
    RETURNING id INTO v_prod;

  INSERT INTO customers (name, customer_type, loyalty_points)
    VALUES ('SC Gate Customer', 'retail', 0) RETURNING id INTO v_cust;

  -- Seed du solde d'avoir via l'unique writer (50 000).
  PERFORM 1 FROM customers WHERE id = v_cust FOR UPDATE;
  PERFORM _apply_store_credit_v1(v_cust, 50000, 'manager_grant', NULL, NULL, NULL, v_prof, NULL);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  PERFORM set_config('scg.prod', v_prod::text, true);
  PERFORM set_config('scg.sess', v_sess::text, true);
  PERFORM set_config('scg.cust', v_cust::text, true);
  PERFORM set_config('scg.idem', gen_random_uuid()::text, true);
END $$;

-- T1 — tender store_credit SANS client rattaché → P0015.
SELECT throws_ok($q$
  SELECT complete_order_with_payment_v21(
    p_session_id := current_setting('scg.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('scg.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','store_credit','amount',20000))
$q$, 'P0015', 'Store credit payment requires a customer',
  'T1: store_credit tender without customer rejected (P0015)');

-- T2 — solde insuffisant (60 000 > 50 000) → P0016.
SELECT throws_ok($q$
  SELECT complete_order_with_payment_v21(
    p_session_id := current_setting('scg.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('scg.prod')::uuid, 'quantity', 3, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','store_credit','amount',60000),
    p_customer_id := current_setting('scg.cust')::uuid)
$q$, 'P0016', NULL,
  'T2: single tender above balance rejected (P0016)');

-- T3 — agrégation multi-tender : 30 000 + 30 000 > 50 000 → P0016.
SELECT throws_ok($q$
  SELECT complete_order_with_payment_v21(
    p_session_id := current_setting('scg.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('scg.prod')::uuid, 'quantity', 3, 'unit_price', 20000)),
    p_payments := jsonb_build_array(
      jsonb_build_object('method','store_credit','amount',30000),
      jsonb_build_object('method','store_credit','amount',30000)),
    p_customer_id := current_setting('scg.cust')::uuid)
$q$, 'P0016', NULL,
  'T3: aggregated store_credit tenders above balance rejected (P0016)');

-- T4 — succès : vente 20 000 payée en avoir → 1 ligne spend, solde 30 000.
DO $$
DECLARE v_res JSONB; v_n INT; v_bal NUMERIC; v_ledger_bal NUMERIC;
BEGIN
  v_res := complete_order_with_payment_v21(
    p_session_id := current_setting('scg.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('scg.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','store_credit','amount',20000),
    p_customer_id := current_setting('scg.cust')::uuid,
    p_idempotency_key := current_setting('scg.idem')::uuid);
  PERFORM set_config('scg.order1', v_res->>'order_id', true);

  SELECT count(*) INTO v_n FROM customer_store_credit_ledger
   WHERE customer_id = current_setting('scg.cust')::uuid AND source='spend'
     AND delta = -20000 AND reference_id = (v_res->>'order_id')::uuid;
  SELECT store_credit_balance INTO v_bal FROM customers WHERE id = current_setting('scg.cust')::uuid;
  -- NB : dans une même transaction, created_at est identique pour toutes les
  -- lignes — on vise la ligne spend par sa référence, pas par un tri temporel.
  SELECT balance_after INTO v_ledger_bal FROM customer_store_credit_ledger
   WHERE customer_id = current_setting('scg.cust')::uuid AND source='spend'
     AND reference_id = (v_res->>'order_id')::uuid;
  PERFORM set_config('scg.t4', (v_n=1 AND v_bal=30000 AND v_ledger_bal=30000)::text, true);
END $$;
SELECT ok(current_setting('scg.t4')::boolean,
  'T4: store_credit sale writes one spend ledger row, balance 50000 -> 30000');

-- T5 — replay idempotent : même clé → enveloppe, AUCUN nouveau débit.
DO $$
DECLARE v_res JSONB; v_n INT; v_bal NUMERIC;
BEGIN
  v_res := complete_order_with_payment_v21(
    p_session_id := current_setting('scg.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('scg.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','store_credit','amount',20000),
    p_customer_id := current_setting('scg.cust')::uuid,
    p_idempotency_key := current_setting('scg.idem')::uuid);
  SELECT count(*) INTO v_n FROM customer_store_credit_ledger
   WHERE customer_id = current_setting('scg.cust')::uuid AND source='spend';
  SELECT store_credit_balance INTO v_bal FROM customers WHERE id = current_setting('scg.cust')::uuid;
  PERFORM set_config('scg.t5',
    ((v_res->>'idempotent_replay')::boolean AND v_n=1 AND v_bal=30000)::text, true);
END $$;
SELECT ok(current_setting('scg.t5')::boolean,
  'T5: idempotent replay returns envelope, no second spend, balance unchanged');

-- T6/T7/T8 — append-only du ledger pour authenticated.
SELECT ok(NOT has_table_privilege('authenticated', 'public.customer_store_credit_ledger', 'INSERT'),
  'T6: authenticated cannot INSERT into customer_store_credit_ledger');
SELECT ok(NOT has_table_privilege('authenticated', 'public.customer_store_credit_ledger', 'UPDATE'),
  'T7: authenticated cannot UPDATE customer_store_credit_ledger');
SELECT ok(NOT has_column_privilege('authenticated', 'public.customers', 'store_credit_balance', 'UPDATE'),
  'T8: authenticated cannot UPDATE customers.store_credit_balance directly');

-- T9 — backstop CHECK >= 0 sur le cache de solde.
SELECT throws_ok($q$
  UPDATE customers SET store_credit_balance = -1
   WHERE id = current_setting('scg.cust')::uuid
$q$, '23514', NULL,
  'T9: store_credit_balance CHECK >= 0 blocks negative balances');

SELECT * FROM finish();
ROLLBACK;
