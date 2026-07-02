-- supabase/tests/combo_server_pricing.test.sql
-- S57 P2.1 (Chantier A, A-D1/A-D2) — server-side combo pricing + validation via
-- _resolve_combo_price_v1, exercised through complete_order_with_payment_v17.
--
-- T1 : surcharge billed in the order total (revenue leak A-D1 closed).
-- T2 : component outside the combo's groups -> combo_invalid_component.
-- T3 : required group left unselected (min_select violated) -> combo_group_violation.
-- T4 : non-combo sale unaffected (regression, identical to pre-S57 v16 behavior).
--
-- Cashier ...0002 has pos.sale.create. Reuses an existing open session for
-- that cashier if one is already persisted (pos_sessions.one_open_session_per_user
-- is a real EXCLUDE constraint — a blind INSERT would fail if a prior test left
-- a session open), else creates one.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$
DECLARE v_sess UUID;
BEGIN
  SELECT id INTO v_sess FROM pos_sessions
    WHERE opened_by = '00000000-0000-0000-0000-000000000002' AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  IF v_sess IS NULL THEN
    v_sess := '00000000-0000-0000-0000-0000000cs001';
    INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
      VALUES (v_sess, '00000000-0000-0000-0000-000000000002', 0, 'open');
  END IF;
  PERFORM set_config('csp.sess', v_sess::text, false);
END $$;

INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, combo_base_price) VALUES
  ('00000000-0000-0000-0000-0000000cp001','S57-CB1','S57 Combo Pricing','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',0,'combo',0,false,40000),
  ('00000000-0000-0000-0000-0000000fp001','S57-FP1','S57 Regular Size','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL),
  ('00000000-0000-0000-0000-0000000fp002','S57-FP2','S57 Large Size','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL),
  ('00000000-0000-0000-0000-0000000fp003','S57-FP3','S57 Water','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',10000,'finished',100,true,NULL),
  ('00000000-0000-0000-0000-0000000fp004','S57-FP4','S57 Non-combo standalone','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',20000,'finished',100,true,NULL),
  -- Not a member of any combo_group_options -> used for T2 (combo_invalid_component).
  ('00000000-0000-0000-0000-0000000fp099','S57-FP99','S57 Outsider Product','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',5000,'finished',100,true,NULL);

-- Groups: "Size" (single, required, min1/max1 — Regular surcharge 0, Large surcharge 8000)
--         "Drink" (single, required, min1/max1 — Water surcharge 0).
INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000cg100','00000000-0000-0000-0000-0000000cp001','Size','single',true,1,1,0),
  ('00000000-0000-0000-0000-0000000cg101','00000000-0000-0000-0000-0000000cp001','Drink','single',true,1,1,1);
INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default, sort_order) VALUES
  ('00000000-0000-0000-0000-0000000cg100','00000000-0000-0000-0000-0000000fp001',0,   true,  0),
  ('00000000-0000-0000-0000-0000000cg100','00000000-0000-0000-0000-0000000fp002',8000,false, 1),
  ('00000000-0000-0000-0000-0000000cg101','00000000-0000-0000-0000-0000000fp003',0,   true,  0);

-- T1: Large (surcharge 8000) + Water (surcharge 0) -> 40000 + 8000 = 48000.
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v17(
    p_session_id := current_setting('csp.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000cp001","quantity":1,"unit_price":40000,"modifiers":[],
                  "combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fp002","quantity":1},
                                      {"product_id":"00000000-0000-0000-0000-0000000fp003","quantity":1}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":48000,"cash_received":48000,"change_given":0}'::jsonb
  );
  PERFORM set_config('csp.order1', r->>'order_id', false);
  PERFORM set_config('csp.total1', r->>'total', false);
END $$;

-- T4: plain non-combo sale, unaffected by the combo hunks.
DO $$
DECLARE r jsonb; p numeric;
BEGIN
  p := get_customer_product_price('00000000-0000-0000-0000-0000000fp004', NULL);
  r := complete_order_with_payment_v17(
    p_session_id := current_setting('csp.sess')::uuid,
    p_order_type := 'take_out'::order_type,
    p_items := ('[{"product_id":"00000000-0000-0000-0000-0000000fp004","quantity":1,"unit_price":'||p||',"modifiers":[]}]')::jsonb,
    p_payment := ('{"method":"cash","amount":'||p||',"cash_received":'||p||',"change_given":0}')::jsonb
  );
  PERFORM set_config('csp.total4', r->>'total', false);
END $$;

SELECT plan(5);

SELECT is((SELECT line_total::int FROM order_items WHERE order_id=current_setting('csp.order1')::uuid), 48000,
  'T1 combo surcharge billed: 40000 base + 8000 Large surcharge = 48000');
SELECT is(current_setting('csp.total1')::int, 48000, 'T1b order total reflects the surcharge-inclusive combo price');

SELECT throws_ok($q$ SELECT complete_order_with_payment_v17(
    p_session_id := current_setting('csp.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000cp001","quantity":1,"unit_price":40000,"modifiers":[],
                  "combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fp099","quantity":1},
                                      {"product_id":"00000000-0000-0000-0000-0000000fp003","quantity":1}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb) $q$,
  '23514', NULL, 'T2 component outside the combo groups -> combo_invalid_component (check_violation)');

SELECT throws_ok($q$ SELECT complete_order_with_payment_v17(
    p_session_id := current_setting('csp.sess')::uuid, p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000cp001","quantity":1,"unit_price":40000,"modifiers":[],
                  "combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fp003","quantity":1}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb) $q$,
  '23514', NULL, 'T3 required "Size" group unselected (min_select violated) -> combo_group_violation');

SELECT is(current_setting('csp.total4')::int, 20000, 'T4 non-combo sale total unaffected (regression vs pre-S57 v16)');

SELECT * FROM finish();
ROLLBACK;
