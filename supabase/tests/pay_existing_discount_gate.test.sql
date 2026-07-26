-- supabase/tests/pay_existing_discount_gate.test.sql
-- ADR-013 Lot 2 D9 — pay_existing_order_v16 : la remise money-path exige un nonce
-- discount_authorizations à usage unique (miroir complete_order_v19). Le gate
-- permission-only « nu » (S37, trou E1) est clos : un autorisateur valide SANS
-- nonce est désormais REFUSÉ (P0003). Bypass au replay offline (p_offline_replay).
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(7);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_mgr_prof UUID; v_weak_prof UUID;
  v_cat UUID; v_prod UUID;
  v_o1 UUID; v_o2 UUID; v_o3 UUID; v_o4 UUID; v_o5 UUID; v_o6 UUID;
  v_nonce4 UUID;
BEGIN
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'payments.process')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);

  SELECT up.id INTO v_mgr_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'sales.discount')
   LIMIT 1;

  SELECT up.id INTO v_weak_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND NOT has_permission(up.auth_user_id, 'sales.discount')
   LIMIT 1;

  SELECT id INTO v_cat FROM categories WHERE deleted_at IS NULL LIMIT 1;
  INSERT INTO products (sku,name,category_id,retail_price,cost_price,unit,current_stock)
    VALUES ('TST-D9-PE','D9 PayExisting',v_cat,20000,7000,'pcs',100) RETURNING id INTO v_prod;

  -- 6 draft orders style tablet (session_id NULL autorisé pour created_via='tablet').
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via)
    SELECT '#D9-'||g, 'dine_in','draft',20000,0,20000,'tablet'
      FROM generate_series(1,6) g;

  -- Récupère les 6 ids déterministes par order_number.
  SELECT id INTO v_o1 FROM orders WHERE order_number = '#D9-1';
  SELECT id INTO v_o2 FROM orders WHERE order_number = '#D9-2';
  SELECT id INTO v_o3 FROM orders WHERE order_number = '#D9-3';
  SELECT id INTO v_o4 FROM orders WHERE order_number = '#D9-4';
  SELECT id INTO v_o5 FROM orders WHERE order_number = '#D9-5';
  SELECT id INTO v_o6 FROM orders WHERE order_number = '#D9-6';

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    SELECT o, v_prod, 'D9 PayExisting', 20000, 1, 20000
      FROM unnest(ARRAY[v_o1, v_o2, v_o3, v_o4, v_o5, v_o6]) AS o;

  -- Nonce valide pour T4 (mint service-role, comme verify-manager-pin).
  INSERT INTO discount_authorizations (manager_profile_id, scope)
    VALUES (v_mgr_prof, 'discount') RETURNING id INTO v_nonce4;

  PERFORM set_config('breakery.v_o1', v_o1::text, true);
  PERFORM set_config('breakery.v_o2', v_o2::text, true);
  PERFORM set_config('breakery.v_o3', v_o3::text, true);
  PERFORM set_config('breakery.v_o4', v_o4::text, true);
  PERFORM set_config('breakery.v_o5', v_o5::text, true);
  PERFORM set_config('breakery.v_o6', v_o6::text, true);
  PERFORM set_config('breakery.v_mgr', v_mgr_prof::text, true);
  PERFORM set_config('breakery.v_weak', COALESCE(v_weak_prof::text,''), true);
  PERFORM set_config('breakery.v_nonce4', v_nonce4::text, true);
END $$;

-- T1 : discount > 0 sans authorizer → P0014 (ADR-013 Lot 3 : ERRCODE dédié, ex-P0001)
SELECT throws_ok(
  $$ SELECT pay_existing_order_v16(
       p_order_id := current_setting('breakery.v_o1')::uuid,
       p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',17000),
       p_discount_amount := 3000) $$,
  'P0014', NULL, 'T1 discount sans authorizer → P0014');

-- T2 : authorizer sans sales.discount → P0003
SELECT throws_ok(
  $$ SELECT pay_existing_order_v16(
       p_order_id := current_setting('breakery.v_o2')::uuid,
       p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',17000),
       p_discount_amount := 3000,
       p_discount_authorized_by := current_setting('breakery.v_weak')::uuid) $$,
  'P0003', NULL, 'T2 authorizer sans sales.discount → P0003');

-- T3 : authorizer VALIDE mais AUCUN nonce (E1 clos) → P0003 'Invalid manager PIN'
SELECT throws_ok(
  $$ SELECT pay_existing_order_v16(
       p_order_id := current_setting('breakery.v_o3')::uuid,
       p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',17000),
       p_discount_amount := 3000,
       p_discount_authorized_by := current_setting('breakery.v_mgr')::uuid) $$,
  'P0003', 'Invalid manager PIN for discount authorization',
  'T3 authorizer valide SANS nonce → refusé P0003 (E1 clos)');

-- T4 : nonce valide → succès + total réel + audit pin_gated=true + nonce consommé.
DO $$ DECLARE v_res JSONB; v_audit INT; v_consumed TIMESTAMPTZ;
BEGIN
  v_res := pay_existing_order_v16(
    p_order_id := current_setting('breakery.v_o4')::uuid,
    p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',20000,'change_given',3000),
    p_discount_amount := 3000,
    p_discount_type := 'fixed_amount',
    p_discount_reason := 'pgTAP T4',
    p_discount_authorized_by := current_setting('breakery.v_mgr')::uuid,
    p_discount_auth_id := current_setting('breakery.v_nonce4')::uuid);
  SELECT count(*) INTO v_audit FROM audit_logs
   WHERE action = 'order.discount_applied' AND entity_id = current_setting('breakery.v_o4')::uuid
     AND (metadata->>'pin_gated')::boolean = true;
  SELECT consumed_at INTO v_consumed FROM discount_authorizations
   WHERE id = current_setting('breakery.v_nonce4')::uuid;
  PERFORM set_config('breakery.t4_ok', ((v_res->>'total')::numeric = 17000)::text, true);
  PERFORM set_config('breakery.t4_audit', (v_audit = 1)::text, true);
  PERFORM set_config('breakery.t4_consumed', (v_consumed IS NOT NULL)::text, true);
END $$;
SELECT is(current_setting('breakery.t4_ok'), 'true', 'T4 nonce valide → succès total réel 17000');
SELECT is(current_setting('breakery.t4_audit'), 'true', 'T5 audit order.discount_applied pin_gated=true');
SELECT is(current_setting('breakery.t4_consumed'), 'true', 'T6 nonce consommé (consumed_at renseigné)');

-- T7 : offline_replay bypass — discount SANS nonce mais p_offline_replay=true → succès.
DO $$ DECLARE v_res JSONB;
BEGIN
  v_res := pay_existing_order_v16(
    p_order_id := current_setting('breakery.v_o5')::uuid,
    p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',17000),
    p_discount_amount := 3000,
    p_discount_reason := 'pgTAP T7 offline',
    p_discount_authorized_by := current_setting('breakery.v_mgr')::uuid,
    p_offline_replay := true);
  PERFORM set_config('breakery.t7_ok', ((v_res->>'total')::numeric = 17000)::text, true);
END $$;
SELECT is(current_setting('breakery.t7_ok'), 'true', 'T7 offline_replay bypass le nonce → succès');

SELECT * FROM finish();
ROLLBACK;
