-- supabase/tests/discount_auth_nonce.test.sql
-- S55 P1.5 (audit T7) Task 6 — complete_order_with_payment_v16 discount-PIN
-- authorization via single-use nonce (discount_authorizations, _085/_086).
--   T1 : discount + no nonce -> P0003
--   T2 : discount + valid nonce -> order created, nonce consumed + traced
--   T3 : replay the SAME nonce -> P0003 (single-use)
--   T4 : expired nonce -> P0003
--   T5 : nonce minted for a DIFFERENT manager than p_discount_authorized_by -> P0003
--   T6 : no discount, no nonce -> succeeds (nominal path untouched)
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

-- ===========================================================================
-- Fixtures : cashier profile w/ open session (pos.sale.create) ; manager
-- profile w/ sales.discount (authorizer) ; SECOND manager w/ sales.discount
-- (for T5's mismatched-manager nonce) ; tracked-inventory product.
-- Pattern lifted from reversal_idempotency.test.sql.
-- ===========================================================================
DO $fixture$
DECLARE
  v_cashier_auth UUID; v_cashier_prof UUID;
  v_mgr_auth UUID; v_mgr_prof UUID;
  v_mgr2_auth UUID; v_mgr2_prof UUID;
  v_sess UUID; v_cat UUID;
  v_prod UUID := '55da0001-0000-0000-0000-000000000001';
BEGIN
  SELECT up.auth_user_id, up.id INTO v_cashier_auth, v_cashier_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create') LIMIT 1;
  IF v_cashier_auth IS NULL THEN RAISE EXCEPTION 'fixture: no profile with pos.sale.create'; END IF;

  SELECT up.auth_user_id, up.id INTO v_mgr_auth, v_mgr_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.discount') LIMIT 1;
  IF v_mgr_prof IS NULL THEN RAISE EXCEPTION 'fixture: no profile with sales.discount'; END IF;

  SELECT up.auth_user_id, up.id INTO v_mgr2_auth, v_mgr2_prof FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.discount')
     AND up.id <> v_mgr_prof LIMIT 1;
  IF v_mgr2_prof IS NULL THEN RAISE EXCEPTION 'fixture: no SECOND profile with sales.discount'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cashier_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_cashier_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_cashier_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  SELECT id INTO v_cat FROM categories LIMIT 1;
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, track_inventory, deduct_stock)
  VALUES (v_prod, 'PGTAP-S55-DAN', 'pgTAP S55 Discount-Auth-Nonce Product', v_cat, 50000, 100.000, true, true)
  ON CONFLICT (id) DO UPDATE SET current_stock=100.000, track_inventory=true, deduct_stock=true, retail_price=50000;

  PERFORM set_config('s55da.cashier_auth', v_cashier_auth::text, true);
  PERFORM set_config('s55da.cashier_prof', v_cashier_prof::text, true);
  PERFORM set_config('s55da.mgr_prof',     v_mgr_prof::text, true);
  PERFORM set_config('s55da.mgr2_prof',    v_mgr2_prof::text, true);
  PERFORM set_config('s55da.sess', v_sess::text, true);
  PERFORM set_config('s55da.prod', v_prod::text, true);
END $fixture$;

-- ===========================================================================
-- T1 — discount > 0, p_discount_auth_id NULL -> P0003 (authorizer + permission
-- checks pass ; the nonce UPDATE affects 0 rows -> NOT FOUND -> P0003).
-- ===========================================================================
DO $t1$
DECLARE
  v_sess UUID := current_setting('s55da.sess')::uuid;
  v_cashier_auth UUID := current_setting('s55da.cashier_auth')::uuid;
  v_mgr_prof UUID := current_setting('s55da.mgr_prof')::uuid;
  v_prod UUID := current_setting('s55da.prod')::uuid;
  v_caught BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  BEGIN
    PERFORM complete_order_with_payment_v16(
      p_session_id := v_sess, p_order_type := 'take_out'::order_type,
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_prod, 'quantity', 1, 'unit_price', 50000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',45000,'cash_received',45000,'change_given',0),
      p_discount_amount := 5000,
      p_discount_authorized_by := v_mgr_prof,
      p_discount_auth_id := NULL);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    v_caught := true;
  END;
  PERFORM set_config('s55da.t1', v_caught::text, false);
END $t1$;
SELECT ok(current_setting('s55da.t1')::boolean,
  'T1: discount with p_discount_auth_id NULL -> SQLSTATE P0003');

-- ===========================================================================
-- T2 — valid nonce (seeded for v_mgr_prof) -> order created, nonce consumed
-- (consumed_at NOT NULL, consumed_order_id = order_id).
-- ===========================================================================
DO $t2$
DECLARE
  v_sess UUID := current_setting('s55da.sess')::uuid;
  v_cashier_auth UUID := current_setting('s55da.cashier_auth')::uuid;
  v_mgr_prof UUID := current_setting('s55da.mgr_prof')::uuid;
  v_prod UUID := current_setting('s55da.prod')::uuid;
  v_nonce UUID;
  v_res JSONB; v_order_id UUID;
  v_consumed_at TIMESTAMPTZ; v_consumed_order UUID;
BEGIN
  INSERT INTO discount_authorizations (manager_profile_id) VALUES (v_mgr_prof) RETURNING id INTO v_nonce;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  v_res := complete_order_with_payment_v16(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 1, 'unit_price', 50000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',45000,'cash_received',45000,'change_given',0),
    p_discount_amount := 5000,
    p_discount_authorized_by := v_mgr_prof,
    p_discount_auth_id := v_nonce);
  v_order_id := (v_res->>'order_id')::uuid;

  SELECT consumed_at, consumed_order_id INTO v_consumed_at, v_consumed_order
    FROM discount_authorizations WHERE id = v_nonce;

  PERFORM set_config('s55da.t2_nonce', v_nonce::text, false);
  PERFORM set_config('s55da.t2', CASE WHEN
    v_order_id IS NOT NULL
    AND (v_res->>'total')::numeric = 45000
    AND v_consumed_at IS NOT NULL
    AND v_consumed_order = v_order_id
  THEN 'true' ELSE 'false' END, false);
END $t2$;
SELECT ok(current_setting('s55da.t2')::boolean,
  'T2: valid nonce -> order created, nonce consumed_at set + consumed_order_id = order_id');

-- ===========================================================================
-- T3 — replay the SAME nonce (already consumed by T2) -> P0003.
-- ===========================================================================
DO $t3$
DECLARE
  v_sess UUID := current_setting('s55da.sess')::uuid;
  v_cashier_auth UUID := current_setting('s55da.cashier_auth')::uuid;
  v_mgr_prof UUID := current_setting('s55da.mgr_prof')::uuid;
  v_prod UUID := current_setting('s55da.prod')::uuid;
  v_nonce UUID := current_setting('s55da.t2_nonce')::uuid;
  v_caught BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  BEGIN
    PERFORM complete_order_with_payment_v16(
      p_session_id := v_sess, p_order_type := 'take_out'::order_type,
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_prod, 'quantity', 1, 'unit_price', 50000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',45000,'cash_received',45000,'change_given',0),
      p_discount_amount := 5000,
      p_discount_authorized_by := v_mgr_prof,
      p_discount_auth_id := v_nonce);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    v_caught := true;
  END;
  PERFORM set_config('s55da.t3', v_caught::text, false);
END $t3$;
SELECT ok(current_setting('s55da.t3')::boolean,
  'T3: replaying the same (already-consumed) nonce -> SQLSTATE P0003');

-- ===========================================================================
-- T4 — nonce with expires_at < now() -> P0003.
-- ===========================================================================
DO $t4$
DECLARE
  v_sess UUID := current_setting('s55da.sess')::uuid;
  v_cashier_auth UUID := current_setting('s55da.cashier_auth')::uuid;
  v_mgr_prof UUID := current_setting('s55da.mgr_prof')::uuid;
  v_prod UUID := current_setting('s55da.prod')::uuid;
  v_nonce UUID;
  v_caught BOOLEAN := false;
BEGIN
  INSERT INTO discount_authorizations (manager_profile_id, expires_at)
    VALUES (v_mgr_prof, now() - interval '1 second')
    RETURNING id INTO v_nonce;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  BEGIN
    PERFORM complete_order_with_payment_v16(
      p_session_id := v_sess, p_order_type := 'take_out'::order_type,
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_prod, 'quantity', 1, 'unit_price', 50000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',45000,'cash_received',45000,'change_given',0),
      p_discount_amount := 5000,
      p_discount_authorized_by := v_mgr_prof,
      p_discount_auth_id := v_nonce);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    v_caught := true;
  END;
  PERFORM set_config('s55da.t4', v_caught::text, false);
END $t4$;
SELECT ok(current_setting('s55da.t4')::boolean,
  'T4: expired nonce (expires_at < now()) -> SQLSTATE P0003');

-- ===========================================================================
-- T5 — nonce minted for a DIFFERENT manager than p_discount_authorized_by -> P0003.
-- ===========================================================================
DO $t5$
DECLARE
  v_sess UUID := current_setting('s55da.sess')::uuid;
  v_cashier_auth UUID := current_setting('s55da.cashier_auth')::uuid;
  v_mgr_prof UUID := current_setting('s55da.mgr_prof')::uuid;
  v_mgr2_prof UUID := current_setting('s55da.mgr2_prof')::uuid;
  v_prod UUID := current_setting('s55da.prod')::uuid;
  v_nonce UUID;
  v_caught BOOLEAN := false;
BEGIN
  -- Nonce minted for mgr2, but the order declares mgr as the authorizer.
  INSERT INTO discount_authorizations (manager_profile_id) VALUES (v_mgr2_prof) RETURNING id INTO v_nonce;

  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  BEGIN
    PERFORM complete_order_with_payment_v16(
      p_session_id := v_sess, p_order_type := 'take_out'::order_type,
      p_items := jsonb_build_array(jsonb_build_object(
        'product_id', v_prod, 'quantity', 1, 'unit_price', 50000, 'modifiers', '[]'::jsonb)),
      p_payment := jsonb_build_object('method','cash','amount',45000,'cash_received',45000,'change_given',0),
      p_discount_amount := 5000,
      p_discount_authorized_by := v_mgr_prof,
      p_discount_auth_id := v_nonce);
  EXCEPTION WHEN SQLSTATE 'P0003' THEN
    v_caught := true;
  END;
  PERFORM set_config('s55da.t5', v_caught::text, false);
END $t5$;
SELECT ok(current_setting('s55da.t5')::boolean,
  'T5: nonce minted for a different manager than p_discount_authorized_by -> SQLSTATE P0003');

-- ===========================================================================
-- T6 — no discount, no nonce -> succeeds (nominal path unaffected by T7).
-- ===========================================================================
DO $t6$
DECLARE
  v_sess UUID := current_setting('s55da.sess')::uuid;
  v_cashier_auth UUID := current_setting('s55da.cashier_auth')::uuid;
  v_prod UUID := current_setting('s55da.prod')::uuid;
  v_res JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_auth::text, true);
  v_res := complete_order_with_payment_v16(
    p_session_id := v_sess, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', v_prod, 'quantity', 1, 'unit_price', 50000, 'modifiers', '[]'::jsonb)),
    p_payment := jsonb_build_object('method','cash','amount',50000,'cash_received',50000,'change_given',0));
  PERFORM set_config('s55da.t6', ((v_res->>'order_id') IS NOT NULL AND (v_res->>'total')::numeric = 50000)::text, false);
END $t6$;
SELECT ok(current_setting('s55da.t6')::boolean,
  'T6: no discount, no nonce -> sale completes normally');

SELECT * FROM finish();
ROLLBACK;
