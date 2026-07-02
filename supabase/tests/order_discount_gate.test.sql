-- supabase/tests/order_discount_gate.test.sql
-- S37 Wave A Task A1 (SEC-01/02/05) — complete_order_with_payment_v16 :
--   discount gate (authorité + PIN), réconciliation unit_price, audits.
-- S55 T7 (Task 6) : v15 -> v16. Le PIN sort des args SQL — T2/T3/T4 sont
-- reconvertis au nonce discount_authorizations (seedé directement, tx-local).
-- "Wrong PIN" (ex-T4) devient "missing/invalid nonce" ; la couverture PIN
-- réelle (mauvais PIN -> EF ne mint aucun nonce) vit dans discount_auth_nonce.test.sql.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(10);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_mgr_prof UUID; v_weak_prof UUID;
  v_cat UUID; v_prod UUID; v_sess UUID; v_promo UUID;
BEGIN
  -- Caller : un user avec pos.sale.create.
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'pos.sale.create')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  -- Authorizer : un profil avec sales.discount, PIN connu (tx-local, rollback).
  SELECT up.id INTO v_mgr_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.discount')
   LIMIT 1;
  UPDATE user_profiles SET pin_hash = extensions.crypt('424242', extensions.gen_salt('bf'))
   WHERE id = v_mgr_prof;

  -- Profil SANS sales.discount.
  SELECT up.id INTO v_weak_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND NOT has_permission(up.auth_user_id, 'sales.discount')
   LIMIT 1;

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku,name,category_id,retail_price,cost_price,unit,current_stock)
    VALUES ('TST-S37-DG','S37 DiscountGate',v_cat,20000,7000,'pcs',100) RETURNING id INTO v_prod;

  SELECT id INTO v_sess FROM pos_sessions WHERE status='open' AND opened_by=v_prof ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN INSERT INTO pos_sessions (opened_by, opening_cash, status) VALUES (v_prof,0,'open') RETURNING id INTO v_sess; END IF;

  -- Promotion permissive pour la gift line T7.
  INSERT INTO promotions (name, slug, type, is_active, gift_product_id)
    VALUES ('S37 test free product', 'tst-s37-free-product', 'free_product', true, v_prod)
    RETURNING id INTO v_promo;

  PERFORM set_config('breakery.v_prod',  v_prod::text,  true);
  PERFORM set_config('breakery.v_sess',  v_sess::text,  true);
  PERFORM set_config('breakery.v_mgr',   v_mgr_prof::text, true);
  PERFORM set_config('breakery.v_weak',  COALESCE(v_weak_prof::text,''), true);
  PERFORM set_config('breakery.v_promo', v_promo::text, true);
END $$;

-- T1 : discount > 0 sans authorized_by → exception P0001
SELECT throws_ok(
  $$ SELECT complete_order_with_payment_v16(
       p_session_id := current_setting('breakery.v_sess')::uuid,
       p_order_type := 'take_out'::order_type,
       p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 20000)),
       p_payment := jsonb_build_object('method','cash','amount',15000,'cash_received',15000),
       p_discount_amount := 5000) $$,
  'P0001', NULL, 'T1 discount without authorizer raises');

-- T2 : authorized_by sans sales.discount → P0003 (fails on has_permission, before
-- the nonce is even consulted -- no nonce needed here).
SELECT throws_ok(
  $$ SELECT complete_order_with_payment_v16(
       p_session_id := current_setting('breakery.v_sess')::uuid,
       p_order_type := 'take_out'::order_type,
       p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 20000)),
       p_payment := jsonb_build_object('method','cash','amount',15000,'cash_received',15000),
       p_discount_amount := 5000,
       p_discount_authorized_by := current_setting('breakery.v_weak')::uuid) $$,
  'P0003', NULL, 'T2 authorizer lacking sales.discount raises P0003');

-- T3 : authorizer valide + nonce valide (seedé tx-local) → succès + audit order.discount_applied
DO $$ DECLARE v_res JSONB; v_oid UUID; v_audit INT; v_nonce UUID;
BEGIN
  INSERT INTO discount_authorizations (manager_profile_id)
    VALUES (current_setting('breakery.v_mgr')::uuid)
    RETURNING id INTO v_nonce;
  v_res := complete_order_with_payment_v16(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',15000,'cash_received',15000),
    p_discount_amount := 5000,
    p_discount_type := 'fixed_amount',
    p_discount_reason := 'pgTAP T3',
    p_discount_authorized_by := current_setting('breakery.v_mgr')::uuid,
    p_discount_auth_id := v_nonce);
  v_oid := (v_res->>'order_id')::uuid;
  SELECT count(*) INTO v_audit FROM audit_logs
   WHERE action = 'order.discount_applied' AND entity_id = v_oid;
  PERFORM set_config('breakery.t3_ok', (v_oid IS NOT NULL AND (v_res->>'total')::numeric = 15000)::text, true);
  PERFORM set_config('breakery.t3_audit', (v_audit = 1)::text, true);
END $$;
SELECT is(current_setting('breakery.t3_ok'), 'true', 'T3 valid authorizer + nonce completes the sale');
SELECT is(current_setting('breakery.t3_audit'), 'true', 'T3 emits one order.discount_applied audit row');

-- T4 : nonce manquant/invalide (ex "mauvais PIN") → P0003. La couverture PIN
-- réelle est côté EF (mauvais PIN => aucun nonce n'est minté) et testée dans
-- discount_auth_nonce.test.sql (T1/T3/T4/T5).
SELECT throws_ok(
  $$ SELECT complete_order_with_payment_v16(
       p_session_id := current_setting('breakery.v_sess')::uuid,
       p_order_type := 'take_out'::order_type,
       p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 20000)),
       p_payment := jsonb_build_object('method','cash','amount',15000,'cash_received',15000),
       p_discount_amount := 5000,
       p_discount_authorized_by := current_setting('breakery.v_mgr')::uuid,
       p_discount_auth_id := gen_random_uuid()) $$,
  'P0003', NULL, 'T4 missing/invalid discount nonce raises P0003');

-- T5 : pas de discount → pas de nonce requis → succès
DO $$ DECLARE v_res JSONB;
BEGIN
  v_res := complete_order_with_payment_v16(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 20000)),
    p_payment := jsonb_build_object('method','cash','amount',20000,'cash_received',20000));
  PERFORM set_config('breakery.t5_ok', ((v_res->>'order_id') IS NOT NULL)::text, true);
END $$;
SELECT is(current_setting('breakery.t5_ok'), 'true', 'T5 no-discount sale needs no nonce');

-- T6 : unit_price client 15000 < retail 20000 sans override → serveur force 20000 + audit
DO $$ DECLARE v_res JSONB; v_oid UUID; v_persisted NUMERIC; v_audit INT;
BEGIN
  v_res := complete_order_with_payment_v16(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 15000)),
    p_payment := jsonb_build_object('method','cash','amount',20000,'cash_received',20000));
  v_oid := (v_res->>'order_id')::uuid;
  SELECT unit_price INTO v_persisted FROM order_items WHERE order_id = v_oid LIMIT 1;
  SELECT count(*) INTO v_audit FROM audit_logs
   WHERE action = 'order.price_overridden' AND entity_id = v_oid;
  PERFORM set_config('breakery.t6_price', (v_persisted = 20000)::text, true);
  PERFORM set_config('breakery.t6_audit', (v_audit = 1)::text, true);
END $$;
SELECT is(current_setting('breakery.t6_price'), 'true', 'T6 server forces retail_price on tampered unit_price');
SELECT is(current_setting('breakery.t6_audit'), 'true', 'T6 emits order.price_overridden audit row');

-- T7 : gift line avec promotion déclarée → prix 0 respecté
DO $$ DECLARE v_res JSONB; v_oid UUID; v_gift_price NUMERIC;
BEGIN
  v_res := complete_order_with_payment_v16(
    p_session_id := current_setting('breakery.v_sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 20000),
      jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 0,
                         'is_promo_gift', true, 'promotion_id', current_setting('breakery.v_promo'))),
    p_payment := jsonb_build_object('method','cash','amount',20000,'cash_received',20000),
    p_promotions := jsonb_build_array(jsonb_build_object(
      'promotion_id', current_setting('breakery.v_promo'), 'amount', 0, 'description', 'pgTAP T7 gift')));
  v_oid := (v_res->>'order_id')::uuid;
  SELECT unit_price INTO v_gift_price FROM order_items
   WHERE order_id = v_oid AND is_promo_gift = true LIMIT 1;
  PERFORM set_config('breakery.t7_ok', (v_gift_price = 0)::text, true);
END $$;
SELECT is(current_setting('breakery.t7_ok'), 'true', 'T7 declared gift line keeps unit_price 0');

-- T8 : gift line SANS promotion déclarée → check_violation
SELECT throws_ok(
  $$ SELECT complete_order_with_payment_v16(
       p_session_id := current_setting('breakery.v_sess')::uuid,
       p_order_type := 'take_out'::order_type,
       p_items := jsonb_build_array(
         jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 20000),
         jsonb_build_object('product_id', current_setting('breakery.v_prod'), 'quantity', 1, 'unit_price', 0, 'is_promo_gift', true)),
       p_payment := jsonb_build_object('method','cash','amount',20000,'cash_received',20000)) $$,
  '23514', NULL, 'T8 undeclared gift line is rejected');

SELECT * FROM finish();
ROLLBACK;
