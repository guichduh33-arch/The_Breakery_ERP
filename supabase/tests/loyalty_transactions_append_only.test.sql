-- supabase/tests/loyalty_transactions_append_only.test.sql
-- S37 Wave A Task A3 (SEC-04) — loyalty_transactions append-only role-level.
-- Red baseline constaté en Task 0 : INSERT/UPDATE/DELETE = true pour authenticated.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(5);

SELECT is(has_table_privilege('authenticated','public.loyalty_transactions','INSERT'), false,
  'T1 authenticated cannot INSERT loyalty_transactions');
SELECT is(has_table_privilege('authenticated','public.loyalty_transactions','UPDATE'), false,
  'T2 authenticated cannot UPDATE loyalty_transactions');
SELECT is(has_table_privilege('authenticated','public.loyalty_transactions','DELETE'), false,
  'T3 authenticated cannot DELETE loyalty_transactions');
SELECT is(has_table_privilege('anon','public.loyalty_transactions','INSERT'), false,
  'T4 anon cannot INSERT loyalty_transactions');

-- T5 sanity : une vente via RPC SECURITY DEFINER insère toujours une earn row.
DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_cat UUID; v_prod UUID; v_sess UUID; v_cust UUID;
  v_res JSONB; v_cnt INT;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku,name,category_id,retail_price,cost_price,unit,current_stock)
    VALUES ('TST-S37-LT','S37 LoyaltySanity',v_cat,50000,10000,'pcs',10) RETURNING id INTO v_prod;
  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof,0,'open') RETURNING id INTO v_sess; END IF;
  INSERT INTO customers (name, customer_type) VALUES ('S37 Loyalty Sanity','retail') RETURNING id INTO v_cust;

  v_res := complete_order_with_payment_v15(
    p_session_id := v_sess,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'quantity', 1, 'unit_price', 50000)),
    p_payment := jsonb_build_object('method','cash','amount',50000,'cash_received',50000),
    p_customer_id := v_cust);

  SELECT count(*) INTO v_cnt FROM loyalty_transactions
   WHERE order_id = (v_res->>'order_id')::uuid AND transaction_type = 'earn';
  PERFORM set_config('breakery.t5_ok', (v_cnt = 1)::text, true);
END $$;
SELECT is(current_setting('breakery.t5_ok'), 'true', 'T5 definer RPC still inserts the earn row');

SELECT * FROM finish();
ROLLBACK;
