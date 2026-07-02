-- supabase/tests/promotion_usage_caps.test.sql
-- S57 P2.1 (Chantier A, A-D4/A-D5/A-D6/A-D7) — promotion usage caps.
--
-- T1 : global cap (max_uses) reached -> evaluate_promotions_v2 stops returning
--      the promo ; a second order declaring it is rejected (check_violation).
-- T2 : per-customer cap (max_uses_per_customer) is scoped per customer_id —
--      a different customer still gets it after the first customer is capped.
-- T3 : anonymous order (no customer_id) bypasses the per-customer cap entirely
--      (A-D6) — usable repeatedly with no customer attached.
-- T4 : voiding an order frees its usage (voided_at IS NOT NULL excluded from
--      the count, A-D7) — evaluate_promotions_v2 returns the promo again.
-- T5 : both caps NULL -> illimité, usable repeatedly without ever being capped.
--
-- LIMITATION (documented, not a gap in the migration): the atomic hard-gate
-- (`pg_advisory_xact_lock` + re-count inside complete_order_with_payment_v17,
-- raising `promo_cap_exceeded`) only fires in a genuine cross-session race —
-- two concurrent checkouts both evaluating the SAME cap before either commits
-- its promotion_applications row. A single-connection, serial pgTAP script
-- cannot reproduce that race (evaluate_promotions_v2's advisory filter always
-- sees the immediately-prior INSERT within the same transaction — read-your-
-- own-writes), so a sequential over-cap attempt is rejected earlier by the
-- PRE-EXISTING "Promotion amount mismatch" check (v_server_eval no longer
-- contains the capped promo) rather than by the `promo_cap_exceeded` message.
-- This IS the actual behavior observed by any real (non-racing) client. T1/T2
-- assert on SQLSTATE 23514 (check_violation) rather than the specific message
-- text for this reason.
--
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope).

BEGIN;
SELECT plan(13);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_prod UUID; v_cat UUID;
  v_cust1 UUID; v_cust2 UUID;
  v_promo_global UUID; v_promo_percust UUID; v_promo_unlim UUID; v_promo_voidfree UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no user_profiles row with pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, track_inventory, is_display_item)
    VALUES ('TST-S57-CAP', 'S57 Promo Cap Product', v_cat, 20000, 1000, true, false)
    RETURNING id INTO v_prod;

  INSERT INTO customers (name, customer_type) VALUES ('S57 Cap Cust 1', 'retail') RETURNING id INTO v_cust1;
  INSERT INTO customers (name, customer_type) VALUES ('S57 Cap Cust 2', 'retail') RETURNING id INTO v_cust2;

  -- Isolate the cart evaluation: deactivate every OTHER active promo for the tx.
  UPDATE promotions SET is_active = false WHERE is_active = true;

  INSERT INTO promotions (name, slug, type, scope, discount_value, max_uses, max_uses_per_customer, is_active)
    VALUES ('S57 Cap Global', 'test-cap-global', 'fixed_amount', 'cart', 2000, 1, NULL, false)
    RETURNING id INTO v_promo_global;
  INSERT INTO promotions (name, slug, type, scope, discount_value, max_uses, max_uses_per_customer, is_active)
    VALUES ('S57 Cap PerCustomer', 'test-cap-percust', 'fixed_amount', 'cart', 1500, NULL, 1, false)
    RETURNING id INTO v_promo_percust;
  INSERT INTO promotions (name, slug, type, scope, discount_value, max_uses, max_uses_per_customer, is_active)
    VALUES ('S57 Cap Unlimited', 'test-cap-unlimited', 'fixed_amount', 'cart', 1000, NULL, NULL, false)
    RETURNING id INTO v_promo_unlim;
  INSERT INTO promotions (name, slug, type, scope, discount_value, max_uses, max_uses_per_customer, is_active)
    VALUES ('S57 Cap VoidFree', 'test-cap-voidfree', 'fixed_amount', 'cart', 1200, 1, NULL, false)
    RETURNING id INTO v_promo_voidfree;

  PERFORM set_config('cap.sess',   v_sess::text,   true);
  PERFORM set_config('cap.prod',   v_prod::text,   true);
  PERFORM set_config('cap.cust1',  v_cust1::text,  true);
  PERFORM set_config('cap.cust2',  v_cust2::text,  true);
  PERFORM set_config('cap.global', v_promo_global::text, true);
  PERFORM set_config('cap.percust', v_promo_percust::text, true);
  PERFORM set_config('cap.unlim',  v_promo_unlim::text, true);
  PERFORM set_config('cap.voidfree', v_promo_voidfree::text, true);
END $$;

-- ===========================================================================
-- T1 — global cap (max_uses = 1).
-- ===========================================================================
UPDATE promotions SET is_active = (slug = 'test-cap-global') WHERE slug LIKE 'test-cap-%';

DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18000,'cash_received',18000,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.global')::uuid, 'amount', 2000)));
  PERFORM set_config('cap.t1_order1', r->>'order_id', false);
END $$;

SELECT is(
  jsonb_array_length(
    (evaluate_promotions_v2(
      jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod'), 'quantity', 1, 'unit_price', 20000)),
      NULL, 20000))->'applied_promotions'),
  0, 'T1a: global cap reached -> evaluate_promotions_v2 no longer returns the promo');

SELECT throws_ok($q$
  SELECT complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18000,'cash_received',18000,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.global')::uuid, 'amount', 2000)))
$q$, '23514', NULL, 'T1b: second order declaring the capped global promo is rejected');

SELECT is(
  (SELECT count(*)::int FROM promotion_applications WHERE promotion_id = current_setting('cap.global')::uuid),
  1, 'T1c: exactly one promotion_applications row recorded for the capped promo');

-- ===========================================================================
-- T2 — per-customer cap (max_uses_per_customer = 1), scoped per customer.
-- ===========================================================================
UPDATE promotions SET is_active = (slug = 'test-cap-percust') WHERE slug LIKE 'test-cap-%';

DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18500,'cash_received',18500,'change_given',0),
    p_customer_id := current_setting('cap.cust1')::uuid,
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.percust')::uuid, 'amount', 1500)));
END $$;

SELECT is(
  jsonb_array_length(
    (evaluate_promotions_v2(
      jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod'), 'quantity', 1, 'unit_price', 20000)),
      current_setting('cap.cust1')::uuid, 20000))->'applied_promotions'),
  0, 'T2a: customer 1 per-customer cap reached -> evaluate excludes it for customer 1');

SELECT is(
  jsonb_array_length(
    (evaluate_promotions_v2(
      jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod'), 'quantity', 1, 'unit_price', 20000)),
      current_setting('cap.cust2')::uuid, 20000))->'applied_promotions'),
  1, 'T2b: customer 2 (different customer) still gets the promo — cap is per-customer, not global');

SELECT throws_ok($q$
  SELECT complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18500,'cash_received',18500,'change_given',0),
    p_customer_id := current_setting('cap.cust1')::uuid,
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.percust')::uuid, 'amount', 1500)))
$q$, '23514', NULL, 'T2c: customer 1 second attempt rejected (per-customer cap already used)');

DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18500,'cash_received',18500,'change_given',0),
    p_customer_id := current_setting('cap.cust2')::uuid,
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.percust')::uuid, 'amount', 1500)));
  PERFORM set_config('cap.t2d_ok', ((r->>'order_id') IS NOT NULL)::text, false);
END $$;
SELECT ok(current_setting('cap.t2d_ok')::boolean,
  'T2d: customer 2 uses the promo successfully (own per-customer allotment)');

-- ===========================================================================
-- T3 — anonymous order bypasses the per-customer cap entirely (A-D6). Reuses
-- 'test-cap-percust' (already exhausted for cust1/cust2 above, irrelevant here
-- since anonymous orders are never scoped by customer_id).
-- ===========================================================================
DO $$
DECLARE r1 jsonb; r2 jsonb;
BEGIN
  r1 := complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18500,'cash_received',18500,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.percust')::uuid, 'amount', 1500)));
  r2 := complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18500,'cash_received',18500,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.percust')::uuid, 'amount', 1500)));
  PERFORM set_config('cap.t3_ok', ((r1->>'order_id') IS NOT NULL AND (r2->>'order_id') IS NOT NULL)::text, false);
END $$;
SELECT ok(current_setting('cap.t3_ok')::boolean,
  'T3: two anonymous orders both succeed with the per-customer-capped promo (cap not applicable)');

-- ===========================================================================
-- T4 — void frees the usage (max_uses = 1).
-- ===========================================================================
UPDATE promotions SET is_active = (slug = 'test-cap-voidfree') WHERE slug LIKE 'test-cap-%';

DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18800,'cash_received',18800,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.voidfree')::uuid, 'amount', 1200)));
  PERFORM set_config('cap.t4_order', r->>'order_id', false);
END $$;

SELECT is(
  jsonb_array_length(
    (evaluate_promotions_v2(
      jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod'), 'quantity', 1, 'unit_price', 20000)),
      NULL, 20000))->'applied_promotions'),
  0, 'T4a: cap reached after first use -> evaluate excludes the promo');

DO $$
DECLARE
  v_mgr_prof UUID; v_mgr_auth UUID;
BEGIN
  SELECT up.id, up.auth_user_id INTO v_mgr_prof, v_mgr_auth FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.void') LIMIT 1;
  PERFORM void_order_rpc_v4(current_setting('cap.t4_order')::uuid, 'S57 promo cap void-frees test', v_mgr_prof, current_setting('request.jwt.claim.sub')::uuid);
END $$;

SELECT is(
  jsonb_array_length(
    (evaluate_promotions_v2(
      jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod'), 'quantity', 1, 'unit_price', 20000)),
      NULL, 20000))->'applied_promotions'),
  1, 'T4b: voiding the order frees the usage -> evaluate returns the promo again');

DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v17(
    p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',18800,'cash_received',18800,'change_given',0),
    p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.voidfree')::uuid, 'amount', 1200)));
  PERFORM set_config('cap.t4c_ok', ((r->>'order_id') IS NOT NULL)::text, false);
END $$;
SELECT ok(current_setting('cap.t4c_ok')::boolean,
  'T4c: after the void, a new order can use the promo again');

-- ===========================================================================
-- T5 — both caps NULL -> illimité, usable repeatedly.
-- ===========================================================================
UPDATE promotions SET is_active = (slug = 'test-cap-unlimited') WHERE slug LIKE 'test-cap-%';

DO $$
DECLARE r jsonb; i INT;
BEGIN
  FOR i IN 1..3 LOOP
    r := complete_order_with_payment_v17(
      p_session_id := current_setting('cap.sess')::uuid, p_order_type := 'take_out'::order_type,
      p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
      p_payment := jsonb_build_object('method','cash','amount',19000,'cash_received',19000,'change_given',0),
      p_promotions := jsonb_build_array(jsonb_build_object('promotion_id', current_setting('cap.unlim')::uuid, 'amount', 1000)));
  END LOOP;
END $$;

SELECT is(
  (SELECT count(*)::int FROM promotion_applications WHERE promotion_id = current_setting('cap.unlim')::uuid),
  3, 'T5a: unlimited promo (both caps NULL) used 3 times without ever being capped');

SELECT is(
  jsonb_array_length(
    (evaluate_promotions_v2(
      jsonb_build_array(jsonb_build_object('product_id', current_setting('cap.prod'), 'quantity', 1, 'unit_price', 20000)),
      NULL, 20000))->'applied_promotions'),
  1, 'T5b: unlimited promo is still returned by evaluate after 3 uses');

SELECT * FROM finish();
ROLLBACK;
