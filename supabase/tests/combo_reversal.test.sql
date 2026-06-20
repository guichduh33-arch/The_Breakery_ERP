-- supabase/tests/combo_reversal.test.sql
-- Session 47 / Task A6 — void/refund restore COMPONENT stock for combo lines.
-- Cashier ...0002 acts; MANAGER ...0004 authorizes. Fresh products + session in-tx.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('00000000-0000-0000-0000-0000000ce002','00000000-0000-0000-0000-000000000002', 0, 'open');
INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, combo_base_price) VALUES
  ('00000000-0000-0000-0000-0000000cb010','S47R-CB','S47R Combo','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',0,'combo',0,false,50000),
  ('00000000-0000-0000-0000-0000000fb010','S47R-F1','S47R Comp1','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL),
  ('00000000-0000-0000-0000-0000000fb011','S47R-F2','S47R Comp2','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL);
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v14(
    p_session_id := '00000000-0000-0000-0000-0000000ce002', p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000cb010","quantity":1,"unit_price":50000,"modifiers":[],"combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fb010","quantity":1},{"product_id":"00000000-0000-0000-0000-0000000fb011","quantity":1}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":50000,"cash_received":50000,"change_given":0}'::jsonb);
  PERFORM void_order_rpc_v3((r->>'order_id')::uuid, 'combo void test', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002');
END $$;
DO $$
DECLARE r jsonb; oi uuid;
BEGIN
  r := complete_order_with_payment_v14(
    p_session_id := '00000000-0000-0000-0000-0000000ce002', p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000cb010","quantity":1,"unit_price":50000,"modifiers":[],"combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fb010","quantity":1},{"product_id":"00000000-0000-0000-0000-0000000fb011","quantity":1}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":50000,"cash_received":50000,"change_given":0}'::jsonb);
  SELECT id INTO oi FROM order_items WHERE order_id = (r->>'order_id')::uuid LIMIT 1;
  PERFORM refund_order_rpc_v4((r->>'order_id')::uuid,
    ('[{"order_item_id":"'||oi||'","qty":1}]')::jsonb,
    '[{"method":"cash","amount":50000}]'::jsonb,
    'combo refund test', '00000000-0000-0000-0000-000000000004', gen_random_uuid(), '00000000-0000-0000-0000-000000000002');
END $$;
SELECT plan(3);
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000cb010'), 0, 'R1 combo product stock still 0 (sale+void+sale+refund)');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fb010'), 100, 'R2 component1 fully restored (void + refund)');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fb011'), 100, 'R3 component2 fully restored');
SELECT * FROM finish();
ROLLBACK;
