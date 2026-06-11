-- supabase/tests/pay_existing_discount_gate.test.sql
-- S37 Wave A Task A2 (SEC-01 + POS-01) — pay_existing_order_v7 :
--   discount gate permission-only (DEV-S37-A2-01) + envelope jsonb.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(5);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_mgr_prof UUID; v_weak_prof UUID;
  v_cat UUID; v_prod UUID; v_o1 UUID; v_o2 UUID; v_o3 UUID;
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
    VALUES ('TST-S37-PE','S37 PayExisting',v_cat,20000,7000,'pcs',100) RETURNING id INTO v_prod;

  -- 3 draft orders style tablet (session_id NULL autorisé pour created_via='tablet').
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T1','dine_in','draft',20000,0,20000,'tablet') RETURNING id INTO v_o1;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T2','dine_in','draft',20000,0,20000,'tablet') RETURNING id INTO v_o2;
  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_via)
    VALUES ('#T3','dine_in','draft',20000,0,20000,'tablet') RETURNING id INTO v_o3;

  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total)
    SELECT o, v_prod, 'S37 PayExisting', 20000, 1, 20000 FROM unnest(ARRAY[v_o1, v_o2, v_o3]) AS o;

  PERFORM set_config('breakery.v_o1', v_o1::text, true);
  PERFORM set_config('breakery.v_o2', v_o2::text, true);
  PERFORM set_config('breakery.v_o3', v_o3::text, true);
  PERFORM set_config('breakery.v_mgr', v_mgr_prof::text, true);
  PERFORM set_config('breakery.v_weak', COALESCE(v_weak_prof::text,''), true);
END $$;

-- T1 : discount > 0 sans authorized_by → P0001
SELECT throws_ok(
  $$ SELECT pay_existing_order_v7(
       p_order_id := current_setting('breakery.v_o1')::uuid,
       p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',17000),
       p_discount_amount := 3000) $$,
  'P0001', NULL, 'T1 discount without authorizer raises');

-- T2 : authorized_by sans sales.discount → P0003
SELECT throws_ok(
  $$ SELECT pay_existing_order_v7(
       p_order_id := current_setting('breakery.v_o2')::uuid,
       p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',17000),
       p_discount_amount := 3000,
       p_discount_authorized_by := current_setting('breakery.v_weak')::uuid) $$,
  'P0003', NULL, 'T2 authorizer lacking sales.discount raises P0003');

-- T3 : authorizer valide (permission-only, pas de PIN) → succès + envelope + audit
DO $$ DECLARE v_res JSONB; v_audit INT;
BEGIN
  v_res := pay_existing_order_v7(
    p_order_id := current_setting('breakery.v_o3')::uuid,
    p_payment := jsonb_build_object('method','cash','amount',17000,'cash_received',20000,'change_given',3000),
    p_discount_amount := 3000,
    p_discount_type := 'fixed_amount',
    p_discount_reason := 'pgTAP T3',
    p_discount_authorized_by := current_setting('breakery.v_mgr')::uuid);
  SELECT count(*) INTO v_audit FROM audit_logs
   WHERE action = 'order.discount_applied' AND entity_id = current_setting('breakery.v_o3')::uuid;
  PERFORM set_config('breakery.t3_ok', ((v_res->>'total')::numeric = 17000)::text, true);
  PERFORM set_config('breakery.t3_keys',
    (v_res ?& ARRAY['order_id','order_number','subtotal','tax_amount','total','change_given','idempotent_replay'])::text, true);
  PERFORM set_config('breakery.t3_audit', (v_audit = 1)::text, true);
END $$;
SELECT is(current_setting('breakery.t3_ok'), 'true', 'T3 authorized discount succeeds with real total 17000');
SELECT is(current_setting('breakery.t3_keys'), 'true', 'T4 jsonb envelope carries all POS-01 keys');
SELECT is(current_setting('breakery.t3_audit'), 'true', 'T5 emits one order.discount_applied audit row');

SELECT * FROM finish();
ROLLBACK;
