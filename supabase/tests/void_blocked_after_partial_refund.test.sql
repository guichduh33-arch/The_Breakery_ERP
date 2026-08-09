-- supabase/tests/void_blocked_after_partial_refund.test.sql
-- ADR-013 Lot 2 D1 — void_order_rpc_v9 refuse le void si un refund partiel
-- (non-`is_full_void`) existe déjà pour l'ordre. Non-régression : sans refund,
-- le void réussit toujours.
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope). Fixtures : motif lifté de
-- reversal_idempotency.test.sql (profils seedés réels, pas d'UUID hardcodé).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);

DO $fixture$
DECLARE
  v_cashier_auth UUID; v_cashier_prof UUID; v_manager_prof UUID; v_sess UUID; v_cat UUID;
  v_prod UUID := 'd1b00001-0000-0000-0000-000000000001';
BEGIN
  SELECT up.auth_user_id, up.id INTO v_cashier_auth, v_cashier_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'payments.process')
     AND has_permission(up.auth_user_id, 'pos.sale.create') LIMIT 1;
  IF v_cashier_auth IS NULL THEN RAISE EXCEPTION 'fixture: no cashier profile'; END IF;

  SELECT up.id INTO v_manager_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.void') LIMIT 1;
  IF v_manager_prof IS NULL THEN RAISE EXCEPTION 'fixture: no manager with pos.sale.void'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_cashier_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_cashier_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  SELECT id INTO v_cat FROM categories LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, track_inventory, deduct_stock)
  VALUES (v_prod, 'PGTAP-D1-VOIDGUARD', 'pgTAP D1 Void-Guard Product', v_cat, 25000, 100.000, true, true)
  ON CONFLICT (id) DO UPDATE SET current_stock=100.000, track_inventory=true, deduct_stock=true;

  PERFORM set_config('d1.cashier_auth', v_cashier_auth::text, true);
  PERFORM set_config('d1.cashier_prof', v_cashier_prof::text, true);
  PERFORM set_config('d1.manager_prof', v_manager_prof::text, true);
  PERFORM set_config('d1.sess', v_sess::text, true);
  PERFORM set_config('d1.prod', v_prod::text, true);
END $fixture$;

-- T1 — ordre payé + refund PARTIEL (is_full_void=false) → void refusé (23514).
DO $t1$
DECLARE
  v_sess UUID := current_setting('d1.sess')::uuid;
  v_cashier_auth UUID := current_setting('d1.cashier_auth')::uuid;
  v_cashier_prof UUID := current_setting('d1.cashier_prof')::uuid;
  v_manager_prof UUID := current_setting('d1.manager_prof')::uuid;
  v_prod UUID := current_setting('d1.prod')::uuid;
  v_order JSONB; v_order_id UUID; v_caught BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  v_order := complete_order_with_payment_v24(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 2, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',50000,'cash_received',50000,'change_given',0));
  v_order_id := (v_order->>'order_id')::uuid;

  -- refund partiel simulé (insertion directe : la garde D1 teste EXISTS refunds is_full_void=false)
  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void)
  VALUES ('R-D1-PARTIAL', v_order_id, v_sess, 10000, 909, 'partial refund test', v_cashier_prof, v_manager_prof, false);

  BEGIN
    PERFORM void_order_rpc_v9(v_order_id, 'D1 void after partial refund', v_manager_prof, v_cashier_auth, NULL);
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_caught := true;
  END;

  PERFORM set_config('d1.t1', v_caught::text, false);
  -- l'ordre ne doit PAS avoir été voidé
  PERFORM set_config('d1.t1b', ((SELECT status FROM orders WHERE id=v_order_id) = 'paid')::text, false);
END $t1$;
SELECT ok(current_setting('d1.t1')::boolean,
  'T1 void après refund partiel → SQLSTATE 23514 (refusé)');
SELECT ok(current_setting('d1.t1b')::boolean,
  'T1b ordre reste paid (aucune mutation partielle)');

-- T2 — ordre payé SANS refund → void réussit (non-régression).
DO $t2$
DECLARE
  v_sess UUID := current_setting('d1.sess')::uuid;
  v_cashier_auth UUID := current_setting('d1.cashier_auth')::uuid;
  v_manager_prof UUID := current_setting('d1.manager_prof')::uuid;
  v_prod UUID := current_setting('d1.prod')::uuid;
  v_order JSONB; v_order_id UUID; v_res JSONB; v_full INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  v_order := complete_order_with_payment_v24(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 1, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',25000,'cash_received',25000,'change_given',0));
  v_order_id := (v_order->>'order_id')::uuid;

  v_res := void_order_rpc_v9(v_order_id, 'D1 clean void', v_manager_prof, v_cashier_auth, NULL);
  SELECT count(*) INTO v_full FROM refunds WHERE order_id=v_order_id AND is_full_void=true;

  PERFORM set_config('d1.t2', CASE WHEN
    (SELECT status FROM orders WHERE id=v_order_id) = 'voided'
    AND (v_res->>'refund_id') IS NOT NULL
    AND v_full = 1
  THEN 'true' ELSE 'false' END, false);
END $t2$;
SELECT ok(current_setting('d1.t2')::boolean,
  'T2 void sans refund préalable → réussit (voided, refund is_full_void)');

SELECT * FROM finish();
ROLLBACK;
