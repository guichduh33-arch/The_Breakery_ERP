-- supabase/tests/adr013_lot3_totals_parity.test.sql
-- ADR-013 Lot 3 (D11) — parité client/serveur de l'ordre canonique des totaux :
--   items → promo → redemption → remise panier → taxe (_pb1_split_v1).
-- Gate spec 013x Lot 3 : « total affiché POS == total débité serveur sur
-- promo+remise% ». Le client (calculateTotals) et complete_order_with_payment_v20
-- appliquent le même pipeline ; ce test rejoue le calcul canonique en SQL et
-- vérifie que l'enveloppe du RPC le reproduit exactement.
--
-- Scénario T1-T3 : items 3×20000=60000 ; promo fixed_amount 5000 → 55000 ;
-- redemption 1000 pts (=10000) → 45000 ; remise panier 10% (=4500) → 40500 ;
-- puis _pb1_split_v1. T4 : garde étagée « Redemption exceeds post-promotion
-- total » (redemption > post-promo, message dédié D11).
--
-- Run via MCP execute_sql (BEGIN..ROLLBACK) ou API-from-file.

BEGIN;
SELECT plan(5);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_mgr_prof UUID;
  v_cat UUID; v_prod UUID; v_sess UUID; v_promo UUID;
  v_cust1 UUID; v_cust2 UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'fixture: no user with pos.sale.create'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT up.id INTO v_mgr_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.discount')
   LIMIT 1;

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, track_inventory, is_display_item)
    VALUES ('TST-ADR013-PAR', 'ADR013 Parity Product', v_cat, 20000, 1000, true, false)
    RETURNING id INTO v_prod;

  INSERT INTO customers (name, customer_type, loyalty_points)
    VALUES ('ADR013 Parity Cust 1', 'retail', 2000) RETURNING id INTO v_cust1;
  INSERT INTO customers (name, customer_type, loyalty_points)
    VALUES ('ADR013 Parity Cust 2', 'retail', 2000) RETURNING id INTO v_cust2;

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  END IF;

  -- Isoler l'évaluation promo : désactiver tout autre promo pour la tx.
  UPDATE promotions SET is_active = false WHERE is_active = true;
  INSERT INTO promotions (name, slug, type, scope, discount_value, is_active)
    VALUES ('ADR013 Parity Promo', 'tst-adr013-parity', 'fixed_amount', 'cart', 5000, true)
    RETURNING id INTO v_promo;

  PERFORM set_config('par.prod',  v_prod::text,  true);
  PERFORM set_config('par.sess',  v_sess::text,  true);
  PERFORM set_config('par.mgr',   v_mgr_prof::text, true);
  PERFORM set_config('par.promo', v_promo::text, true);
  PERFORM set_config('par.cust1', v_cust1::text, true);
  PERFORM set_config('par.cust2', v_cust2::text, true);
END $$;

-- T1 — happy path promo + redemption + remise% : le RPC accepte le paiement
-- calculé par le pipeline canonique (payment.amount = _pb1_split_v1(40500).total).
DO $$
DECLARE v_nonce UUID; v_expected NUMERIC; v_res JSONB;
BEGIN
  INSERT INTO discount_authorizations (manager_profile_id)
    VALUES (current_setting('par.mgr')::uuid) RETURNING id INTO v_nonce;
  SELECT s.total INTO v_expected FROM _pb1_split_v1(40500) s;
  v_res := complete_order_with_payment_v20(
    p_session_id := current_setting('par.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('par.prod')::uuid, 'quantity', 3, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',v_expected,'cash_received',v_expected,'change_given',0),
    p_customer_id := current_setting('par.cust1')::uuid,
    p_loyalty_points_redeemed := 1000,
    p_discount_amount := 4500,
    p_discount_type := 'percentage',
    p_discount_value := 10,
    p_discount_reason := 'pgTAP ADR013 parity',
    p_discount_authorized_by := current_setting('par.mgr')::uuid,
    p_discount_auth_id := v_nonce,
    p_promotions := jsonb_build_array(jsonb_build_object(
      'promotion_id', current_setting('par.promo')::uuid, 'amount', 5000)));
  PERFORM set_config('par.t1_total',    v_res->>'total', false);
  PERFORM set_config('par.t1_subtotal', v_res->>'subtotal', false);
  PERFORM set_config('par.t1_promo',    v_res->>'promotion_total', false);
  PERFORM set_config('par.t1_expected', v_expected::text, false);
END $$;
SELECT pass('T1: promo+redemption+remise%% accepted at the canonical pipeline amount');

-- T2 — total débité == pipeline canonique (items→promo→redemption→remise→taxe).
SELECT is(
  current_setting('par.t1_total')::numeric,
  current_setting('par.t1_expected')::numeric,
  'T2: envelope total == _pb1_split_v1(60000 - 5000 - 10000 - 4500)');

-- T3 — décomposition de l'enveloppe : subtotal brut et promotion_total serveur.
SELECT ok(
  current_setting('par.t1_subtotal')::numeric = 60000
  AND current_setting('par.t1_promo')::numeric = 5000,
  'T3: envelope carries subtotal=60000 and promotion_total=5000');

-- T4 — garde étagée D11 : redemption (16000) > post-promo (15000) → message dédié.
SELECT throws_ok($q$
  SELECT complete_order_with_payment_v20(
    p_session_id := current_setting('par.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object(
      'product_id', current_setting('par.prod')::uuid, 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',1,'cash_received',1,'change_given',0),
    p_customer_id := current_setting('par.cust2')::uuid,
    p_loyalty_points_redeemed := 1600,
    p_promotions := jsonb_build_array(jsonb_build_object(
      'promotion_id', current_setting('par.promo')::uuid, 'amount', 5000)))
$q$, '23514', 'Redemption exceeds post-promotion total',
  'T4: redemption > post-promo rejected by the D11 tiered guard');

-- T5 — la promo T1 est bien enregistrée (1 application).
SELECT is(
  (SELECT count(*)::int FROM promotion_applications
    WHERE promotion_id = current_setting('par.promo')::uuid),
  1, 'T5: exactly one promotion_applications row for the parity order');

SELECT * FROM finish();
ROLLBACK;
