-- supabase/tests/refund_void_cross_shift_v10.test.sql
-- Lot 6b money-path — refund/void cross-shift controles depuis le back-office.
-- Run via MCP execute_sql, BEGIN ... ROLLBACK (Docker retired).
--
-- Couvre :
--   T1-T4   v9 droppees, v10 presentes ;
--   T5-T6   EXECUTE reserve service_role (ni anon, ni authenticated) ;
--   T7-T9   cross-shift refund store_credit : acteur MANAGER sans session
--           ouverte, commande d'une session close, client rattache → succes,
--           refunds.session_id = session d'ORIGINE, stock restitue (sale_void) ;
--   T10     cross-shift refund avec tender cash → P0016 ;
--   T11     cross-shift par un profil SANS orders.refund (CASHIER) → P0003 ;
--   T12     void cross-shift d'une commande AVEC paiement cash → P0016 ;
--   T13     void cross-shift sans cash (qris) → succes, rattache a l'origine ;
--   T14     chemin meme-session intact : refund cash same-session passe (v9).
--
-- Seed sans detonation : commandes creees par la RPC money-path vivante
-- (les triggers JE de vente/void tirent sur des donnees reelles, comme dans
-- reversal_idempotency.test.sql) ; le trigger JE des refunds est DEFERRED —
-- il ne s'execute jamais sous ROLLBACK, c'est voulu.

BEGIN;
SELECT plan(14);

-- ===== T1-T4 : versions =====
SELECT ok(to_regprocedure('public.refund_order_rpc_v9(uuid,jsonb,jsonb,text,uuid,uuid,uuid)') IS NULL,
  'T1: refund_order_rpc_v9 is dropped');
SELECT ok(to_regprocedure('public.void_order_rpc_v9(uuid,text,uuid,uuid,uuid)') IS NULL,
  'T2: void_order_rpc_v9 is dropped');
SELECT ok(to_regprocedure('public.refund_order_rpc_v10(uuid,jsonb,jsonb,text,uuid,uuid,uuid)') IS NOT NULL,
  'T3: refund_order_rpc_v10 exists');
SELECT ok(to_regprocedure('public.void_order_rpc_v10(uuid,text,uuid,uuid,uuid)') IS NOT NULL,
  'T4: void_order_rpc_v10 exists');

-- ===== T5-T6 : EXECUTE reserve service_role =====
SELECT ok(
  NOT has_function_privilege('anon', 'public.refund_order_rpc_v10(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.refund_order_rpc_v10(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.refund_order_rpc_v10(uuid,jsonb,jsonb,text,uuid,uuid,uuid)', 'EXECUTE'),
  'T5: refund v10 EXECUTE service_role only (not anon, not authenticated)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.void_order_rpc_v10(uuid,text,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.void_order_rpc_v10(uuid,text,uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.void_order_rpc_v10(uuid,text,uuid,uuid,uuid)', 'EXECUTE'),
  'T6: void v10 EXECUTE service_role only (not anon, not authenticated)');

-- ===== Fixtures =====
-- Cashier ...0002 (CASHIER, sans orders.refund) cree les commandes dans une
-- session S1 ensuite CLOSE. Manager ...0004 (MANAGER : pos.sale.refund/void +
-- orders.refund/void via 20260813000004) agit cross-shift SANS session ouverte.
DO $fixture$
DECLARE
  v_cashier_prof UUID := '00000000-0000-0000-0000-000000000002';
  v_cashier_auth UUID := '00000000-0000-0000-0000-000000000002';
  v_manager_prof UUID := '00000000-0000-0000-0000-000000000004';
  v_cat UUID; v_sess UUID; v_cust UUID;
  v_p1 UUID := '6b100001-0000-0000-0000-000000000001';
  v_p2 UUID := '6b100001-0000-0000-0000-000000000002';
  r JSONB; oi UUID;
BEGIN
  -- Aucune session ouverte residuelle pour les deux acteurs dans la tx.
  UPDATE pos_sessions SET status='closed', closed_at=now()
   WHERE opened_by IN (v_cashier_prof, v_manager_prof) AND status='open';

  SELECT id INTO v_cat FROM categories LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, track_inventory, deduct_stock)
  VALUES (v_p1, 'PGTAP-6B-XS1', 'pgTAP lot6b cross-shift P1', v_cat, 25000, 100.000, true, true),
         (v_p2, 'PGTAP-6B-XS2', 'pgTAP lot6b cross-shift P2', v_cat, 30000, 100.000, true, true);

  INSERT INTO customers (name) VALUES ('pgTAP lot6b cross-shift customer') RETURNING id INTO v_cust;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier_auth)::text, true);
  INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_cashier_prof, 0, 'open') RETURNING id INTO v_sess;

  -- R : refund store_credit cross-shift (paye cash, client rattache).
  r := complete_order_with_payment_v25(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',25000,'cash_received',25000,'change_given',0),
    p_customer_id := v_cust);
  PERFORM set_config('lot6b.order_r', r->>'order_id', false);
  SELECT id INTO oi FROM order_items WHERE order_id = (r->>'order_id')::uuid LIMIT 1;
  PERFORM set_config('lot6b.oi_r', oi::text, false);

  -- C : cible des refus (tender cash cross-shift, acteur CASHIER).
  r := complete_order_with_payment_v25(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',25000,'cash_received',25000,'change_given',0));
  PERFORM set_config('lot6b.order_c', r->>'order_id', false);
  SELECT id INTO oi FROM order_items WHERE order_id = (r->>'order_id')::uuid LIMIT 1;
  PERFORM set_config('lot6b.oi_c', oi::text, false);

  -- V1 : void cross-shift refuse (paiement cash).
  r := complete_order_with_payment_v25(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_p2, 'quantity', 1, 'unit_price', 30000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',30000,'cash_received',30000,'change_given',0));
  PERFORM set_config('lot6b.order_v1', r->>'order_id', false);

  -- V2 : void cross-shift accepte (paiement qris, aucun cash).
  r := complete_order_with_payment_v25(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_p2, 'quantity', 1, 'unit_price', 30000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','qris','amount',30000));
  PERFORM set_config('lot6b.order_v2', r->>'order_id', false);

  -- La session d'origine FERME : tout ce qui suit est cross-shift.
  UPDATE pos_sessions SET status='closed', closed_at=now() WHERE id = v_sess;
  PERFORM set_config('lot6b.sess1', v_sess::text, false);
  PERFORM set_config('lot6b.prod1', v_p1::text, false);
END $fixture$;

-- ===== T7-T9 : cross-shift refund store_credit (MANAGER sans session) =====
DO $t7$
DECLARE
  v_order UUID := current_setting('lot6b.order_r')::uuid;
  v_oi UUID := current_setting('lot6b.oi_r')::uuid;
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_res JSONB;
BEGIN
  v_res := refund_order_rpc_v10(
    v_order,
    jsonb_build_array(jsonb_build_object('order_item_id', v_oi, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('method', 'store_credit', 'amount', 25000)),
    'lot6b cross-shift store_credit refund',
    v_mgr, gen_random_uuid(), v_mgr);
  PERFORM set_config('lot6b.t7_refund_id', COALESCE(v_res->>'refund_id',''), false);
  PERFORM set_config('lot6b.t7_pass',
    CASE WHEN (v_res->>'refund_id') IS NOT NULL
          AND COALESCE((v_res->>'idempotent_replay')::boolean, false) = false
         THEN 'pass' ELSE 'fail_' || COALESCE(v_res::text,'null') END, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('lot6b.t7_pass', 'fail_' || SQLSTATE || '_' || SQLERRM, false);
END $t7$;
SELECT ok(COALESCE(current_setting('lot6b.t7_pass', true), 'missing') = 'pass',
  'T7: cross-shift store_credit refund by MANAGER without open session succeeds');

SELECT ok(
  (SELECT session_id::text FROM refunds WHERE id = NULLIF(current_setting('lot6b.t7_refund_id', true), '')::uuid)
  = current_setting('lot6b.sess1', true),
  'T8: cross-shift refund is attached to the ORIGIN session of the order');

SELECT ok(
  EXISTS (SELECT 1 FROM stock_movements
          WHERE movement_type = 'sale_void' AND reference_type = 'refunds'
            AND reference_id = NULLIF(current_setting('lot6b.t7_refund_id', true), '')::uuid
            AND product_id = current_setting('lot6b.prod1', true)::uuid),
  'T9: cross-shift refund restores stock (sale_void movement spot-check)');

-- ===== T10 : cross-shift refund avec tender cash → P0016 =====
DO $t10$
DECLARE
  v_order UUID := current_setting('lot6b.order_c')::uuid;
  v_oi UUID := current_setting('lot6b.oi_c')::uuid;
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_res JSONB;
BEGIN
  v_res := refund_order_rpc_v10(
    v_order,
    jsonb_build_array(jsonb_build_object('order_item_id', v_oi, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 25000)),
    'lot6b cross-shift cash refund must fail',
    v_mgr, gen_random_uuid(), v_mgr);
  PERFORM set_config('lot6b.t10_pass', 'fail_no_raise', false);
EXCEPTION
  WHEN SQLSTATE 'P0016' THEN PERFORM set_config('lot6b.t10_pass', 'pass', false);
  WHEN OTHERS THEN PERFORM set_config('lot6b.t10_pass', 'fail_' || SQLSTATE, false);
END $t10$;
SELECT ok(COALESCE(current_setting('lot6b.t10_pass', true), 'missing') = 'pass',
  'T10: cross-shift refund with a cash tender raises P0016 cash_refund_requires_open_session');

-- ===== T11 : cross-shift par un CASHIER sans orders.refund → P0003 =====
DO $t11$
DECLARE
  v_order UUID := current_setting('lot6b.order_c')::uuid;
  v_oi UUID := current_setting('lot6b.oi_c')::uuid;
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_cashier_auth UUID := '00000000-0000-0000-0000-000000000002';
  v_res JSONB;
BEGIN
  v_res := refund_order_rpc_v10(
    v_order,
    jsonb_build_array(jsonb_build_object('order_item_id', v_oi, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('method', 'store_credit', 'amount', 25000)),
    'lot6b cross-shift by cashier must fail',
    v_mgr, gen_random_uuid(), v_cashier_auth);
  PERFORM set_config('lot6b.t11_pass', 'fail_no_raise', false);
EXCEPTION
  WHEN SQLSTATE 'P0003' THEN PERFORM set_config('lot6b.t11_pass', 'pass', false);
  WHEN OTHERS THEN PERFORM set_config('lot6b.t11_pass', 'fail_' || SQLSTATE, false);
END $t11$;
SELECT ok(COALESCE(current_setting('lot6b.t11_pass', true), 'missing') = 'pass',
  'T11: cross-shift refund by a profile WITHOUT orders.refund (CASHIER) raises P0003');

-- ===== T12 : void cross-shift avec paiement cash → P0016 =====
DO $t12$
DECLARE
  v_order UUID := current_setting('lot6b.order_v1')::uuid;
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_res JSONB;
BEGIN
  v_res := void_order_rpc_v10(v_order, 'lot6b cross-shift cash void must fail', v_mgr, v_mgr, gen_random_uuid());
  PERFORM set_config('lot6b.t12_pass', 'fail_no_raise', false);
EXCEPTION
  WHEN SQLSTATE 'P0016' THEN PERFORM set_config('lot6b.t12_pass', 'pass', false);
  WHEN OTHERS THEN PERFORM set_config('lot6b.t12_pass', 'fail_' || SQLSTATE, false);
END $t12$;
SELECT ok(COALESCE(current_setting('lot6b.t12_pass', true), 'missing') = 'pass',
  'T12: cross-shift void of an order WITH a cash payment raises P0016 cash_void_requires_open_session');

-- ===== T13 : void cross-shift sans cash (qris) → succes rattache a l'origine =====
DO $t13$
DECLARE
  v_order UUID := current_setting('lot6b.order_v2')::uuid;
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_res JSONB;
BEGIN
  v_res := void_order_rpc_v10(v_order, 'lot6b cross-shift qris void', v_mgr, v_mgr, gen_random_uuid());
  PERFORM set_config('lot6b.t13_pass',
    CASE WHEN (SELECT status FROM orders WHERE id = v_order) = 'voided'
          AND (SELECT session_id::text FROM refunds WHERE id = (v_res->>'refund_id')::uuid)
              = current_setting('lot6b.sess1', true)
          AND (SELECT is_full_void FROM refunds WHERE id = (v_res->>'refund_id')::uuid)
         THEN 'pass' ELSE 'fail_' || COALESCE(v_res::text,'null') END, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('lot6b.t13_pass', 'fail_' || SQLSTATE || '_' || SQLERRM, false);
END $t13$;
SELECT ok(COALESCE(current_setting('lot6b.t13_pass', true), 'missing') = 'pass',
  'T13: cross-shift void without cash succeeds, voided + full-void refund on the ORIGIN session');

-- ===== T14 : chemin meme-session intact (refund cash passe comme en v9) =====
DO $t14$
DECLARE
  v_cashier_prof UUID := '00000000-0000-0000-0000-000000000002';
  v_cashier_auth UUID := '00000000-0000-0000-0000-000000000002';
  v_mgr UUID := '00000000-0000-0000-0000-000000000004';
  v_p1 UUID := current_setting('lot6b.prod1')::uuid;
  v_sess2 UUID; r JSONB; oi UUID; v_res JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier_auth)::text, true);
  INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_cashier_prof, 0, 'open') RETURNING id INTO v_sess2;
  r := complete_order_with_payment_v25(
    p_session_id := v_sess2, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', v_p1, 'quantity', 1, 'unit_price', 25000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',25000,'cash_received',25000,'change_given',0));
  SELECT id INTO oi FROM order_items WHERE order_id = (r->>'order_id')::uuid LIMIT 1;
  v_res := refund_order_rpc_v10(
    (r->>'order_id')::uuid,
    jsonb_build_array(jsonb_build_object('order_item_id', oi, 'qty', 1)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 25000)),
    'lot6b same-session cash refund',
    v_mgr, gen_random_uuid(), v_cashier_auth);
  PERFORM set_config('lot6b.t14_pass',
    CASE WHEN (v_res->>'refund_id') IS NOT NULL
          AND (SELECT session_id FROM refunds WHERE id = (v_res->>'refund_id')::uuid) = v_sess2
         THEN 'pass' ELSE 'fail_' || COALESCE(v_res::text,'null') END, false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('lot6b.t14_pass', 'fail_' || SQLSTATE || '_' || SQLERRM, false);
END $t14$;
SELECT ok(COALESCE(current_setting('lot6b.t14_pass', true), 'missing') = 'pass',
  'T14: same-session cash refund still passes (v9 path unchanged, attached to the open session)');

SELECT * FROM finish();
ROLLBACK;
