-- supabase/tests/reversal_idempotency.test.sql
-- S55 P1.5 (audit T7) — EF-retry-safety idempotency on reversal RPCs.
--   VOID   : void_order_rpc_v4 — idempotency_key replay via refunds.idempotency_key.
--   CANCEL : cancel_order_item_rpc_v3 (Task 2, appended below).
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope). pgtap pre-installed on V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

-- ===========================================================================
-- Fixtures : cashier profile (payments.process + pos.sale.create) w/ open
-- session ; manager profile (pos.sale.void) ; tracked-inventory product.
-- Pattern lifted from s44_display_symmetry.test.sql — query real seed
-- profiles instead of hardcoding UUIDs (avoids the created_by FK gotcha).
-- ===========================================================================
DO $fixture$
DECLARE
  v_cashier_auth UUID; v_cashier_prof UUID; v_manager_prof UUID; v_sess UUID; v_cat UUID;
  v_prod UUID := '55de0001-0000-0000-0000-000000000001';
BEGIN
  SELECT up.auth_user_id, up.id INTO v_cashier_auth, v_cashier_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'payments.process')
     AND has_permission(up.auth_user_id, 'pos.sale.create') LIMIT 1;
  IF v_cashier_auth IS NULL THEN RAISE EXCEPTION 'fixture: no profile with payments.process+pos.sale.create'; END IF;

  SELECT up.id INTO v_manager_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.void') LIMIT 1;
  IF v_manager_prof IS NULL THEN RAISE EXCEPTION 'fixture: no profile with pos.sale.void'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_cashier_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_cashier_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  SELECT id INTO v_cat FROM categories LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, track_inventory, deduct_stock)
  VALUES (v_prod, 'PGTAP-S55-RVI', 'pgTAP S55 Reversal-Idempotency Product', v_cat, 25000, 100.000, true, true)
  ON CONFLICT (id) DO UPDATE SET current_stock=100.000, track_inventory=true, deduct_stock=true;

  PERFORM set_config('s55.cashier_auth', v_cashier_auth::text, true);
  PERFORM set_config('s55.cashier_prof', v_cashier_prof::text, true);
  PERFORM set_config('s55.manager_prof', v_manager_prof::text, true);
  PERFORM set_config('s55.sess', v_sess::text, true);
  PERFORM set_config('s55.prod', v_prod::text, true);
END $fixture$;

-- ===========================================================================
-- VOID T1 — first void_order_rpc_v4 call with key K succeeds : order voided,
-- refund row created, exactly 1 sale_void stock movement written.
-- ===========================================================================
DO $void_t1$
DECLARE
  v_sess UUID := current_setting('s55.sess')::uuid;
  v_cashier_auth UUID := current_setting('s55.cashier_auth')::uuid;
  v_manager_prof UUID := current_setting('s55.manager_prof')::uuid;
  v_prod UUID := current_setting('s55.prod')::uuid;
  v_order JSONB; v_order_id UUID; v_key UUID := '55de0002-0000-0000-0000-000000000001';
  v_res JSONB; v_void_count INT; v_refund_count INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  v_order := complete_order_with_payment_v15(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 2, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',50000,'cash_received',50000,'change_given',0));
  v_order_id := (v_order->>'order_id')::uuid;

  v_res := void_order_rpc_v4(v_order_id, 'S55 idempotency void test', v_manager_prof, v_cashier_auth, v_key);

  SELECT COUNT(*) INTO v_void_count FROM stock_movements
    WHERE product_id = v_prod AND movement_type = 'sale_void' AND reference_type = 'orders' AND reference_id = v_order_id;
  SELECT COUNT(*) INTO v_refund_count FROM refunds WHERE order_id = v_order_id;

  PERFORM set_config('s55.void_order_id', v_order_id::text, false);
  PERFORM set_config('s55.void_key', v_key::text, false);
  PERFORM set_config('s55.void_refund_id', (v_res->>'refund_id'), false);
  PERFORM set_config('s55.void_t1', CASE WHEN
    (SELECT status FROM orders WHERE id = v_order_id) = 'voided'
    AND (v_res->>'refund_id') IS NOT NULL
    AND COALESCE((v_res->>'idempotent_replay')::boolean, false) = false
    AND v_void_count = 1
    AND v_refund_count = 1
  THEN 'true' ELSE 'false' END, false);
END $void_t1$;
SELECT ok(current_setting('s55.void_t1')::boolean,
  'VOID T1: first v4 call (key K) succeeds — order voided, refund created, 1 sale_void movement');

-- ===========================================================================
-- VOID T2 — second void_order_rpc_v4 call with the SAME key K replays :
-- idempotent_replay=true, same refund_id, sale_void count unchanged, refunds
-- count for the order stays 1 (no double refund/stock-restore).
-- ===========================================================================
DO $void_t2$
DECLARE
  v_order_id UUID := current_setting('s55.void_order_id')::uuid;
  v_cashier_auth UUID := current_setting('s55.cashier_auth')::uuid;
  v_manager_prof UUID := current_setting('s55.manager_prof')::uuid;
  v_prod UUID := current_setting('s55.prod')::uuid;
  v_key UUID := current_setting('s55.void_key')::uuid;
  v_res2 JSONB; v_void_count INT; v_refund_count INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  v_res2 := void_order_rpc_v4(v_order_id, 'S55 idempotency void test replay', v_manager_prof, v_cashier_auth, v_key);

  SELECT COUNT(*) INTO v_void_count FROM stock_movements
    WHERE product_id = v_prod AND movement_type = 'sale_void' AND reference_type = 'orders' AND reference_id = v_order_id;
  SELECT COUNT(*) INTO v_refund_count FROM refunds WHERE order_id = v_order_id;

  PERFORM set_config('s55.void_t2', CASE WHEN
    (v_res2->>'idempotent_replay')::boolean = true
    AND (v_res2->>'refund_id') = current_setting('s55.void_refund_id')
    AND v_void_count = 1
    AND v_refund_count = 1
  THEN 'true' ELSE 'false' END, false);
END $void_t2$;
SELECT ok(current_setting('s55.void_t2')::boolean,
  'VOID T2: second v4 call (same key K) → idempotent_replay=true, same refund_id, sale_void count unchanged, refunds=1');

-- ============ CANCEL (Task 2) ============

SELECT * FROM finish();
ROLLBACK;
