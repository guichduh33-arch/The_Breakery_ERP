-- supabase/tests/combo_sale.test.sql
-- Session 47 / Task A5 — complete_order_with_payment_v16 combo-aware stock.
-- Cashier ...0002 has pos.sale.create. Fresh products + open session seeded in-tx.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('00000000-0000-0000-0000-0000000ce001','00000000-0000-0000-0000-000000000002', 0, 'open');
UPDATE business_config SET allow_negative_stock=false WHERE id=1;
INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, combo_base_price) VALUES
  ('00000000-0000-0000-0000-0000000cb001','S47-CB1','S47 Combo','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',0,'combo',0,false,50000),
  ('00000000-0000-0000-0000-0000000cb002','S47-CB2','S47 Combo2','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',0,'combo',0,false,30000),
  ('00000000-0000-0000-0000-0000000fa001','S47-F1','S47 Comp1','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL),
  ('00000000-0000-0000-0000-0000000fa002','S47-F2','S47 Comp2','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL),
  ('00000000-0000-0000-0000-0000000fa003','S47-F3','S47 Comp0','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',0,true,NULL),
  ('00000000-0000-0000-0000-0000000fa004','S47-F4','S47 Standalone','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',20000,'finished',100,true,NULL);
-- Seed modifier scope-produit pour le combo CB1 : Drinks/Affogato 5000
-- Nécessaire sous v15 : _resolve_line_price_v1 lookup SERVER-SIDE (client price_adjustment ignoré).
INSERT INTO product_modifiers (product_id, category_id, group_name, option_label, price_adjustment, is_active)
VALUES ('00000000-0000-0000-0000-0000000cb001', NULL, 'Drinks', 'Affogato', 5000, true);
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v16(
    p_session_id := '00000000-0000-0000-0000-0000000ce001',
    p_order_type := 'take_out'::order_type,
    p_items := $items$[
      {"product_id":"00000000-0000-0000-0000-0000000cb001","quantity":1,"unit_price":50000,
       "modifiers":[{"group_name":"Drinks","option_label":"Affogato","price_adjustment":5000}],
       "combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fa001","quantity":1},
                           {"product_id":"00000000-0000-0000-0000-0000000fa002","quantity":1}]}
    ]$items$::jsonb,
    p_payment := '{"method":"cash","amount":55000,"cash_received":55000,"change_given":0}'::jsonb
  );
  PERFORM set_config('combo.order_id', r->>'order_id', false);
END $$;
DO $$
DECLARE r jsonb; p numeric;
BEGIN
  p := get_customer_product_price('00000000-0000-0000-0000-0000000fa004', NULL);
  r := complete_order_with_payment_v16(
    p_session_id := '00000000-0000-0000-0000-0000000ce001',
    p_order_type := 'take_out'::order_type,
    p_items := ('[{"product_id":"00000000-0000-0000-0000-0000000fa004","quantity":2,"unit_price":'||p||',"modifiers":[]}]')::jsonb,
    p_payment := ('{"method":"cash","amount":'||(p*2)||',"cash_received":'||(p*2)||',"change_given":0}')::jsonb
  );
END $$;
SELECT plan(11);
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000cb001'), 0, 'T1 combo product stock unchanged');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fa001'), 99, 'T2a component1 stock -1');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fa002'), 99, 'T2b component2 stock -1');
SELECT is((SELECT count(*)::int FROM order_items WHERE order_id=current_setting('combo.order_id')::uuid), 1, 'T3a one order_item for combo');
SELECT is((SELECT line_total::int FROM order_items WHERE order_id=current_setting('combo.order_id')::uuid), 55000, 'T3b line_total = base+surcharge');
SELECT ok((SELECT combo_components IS NOT NULL FROM order_items WHERE order_id=current_setting('combo.order_id')::uuid), 'T3c combo_components snapshot present');
SELECT is((SELECT product_id FROM order_items WHERE order_id=current_setting('combo.order_id')::uuid), '00000000-0000-0000-0000-0000000cb001'::uuid, 'T3d order_item product_id = combo');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fa004'), 98, 'T4 standalone (non-combo) still deducts itself');
SELECT throws_ok($q$ SELECT complete_order_with_payment_v16(
    p_session_id := '00000000-0000-0000-0000-0000000ce001', p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000cb002","quantity":1,"unit_price":30000,"modifiers":[],"combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fa003","quantity":1}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":30000,"cash_received":30000,"change_given":0}'::jsonb) $q$, 'P0002', NULL, 'T5 insufficient component stock rejected');
SELECT ok(NOT has_function_privilege('anon','complete_order_with_payment_v16(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid)','EXECUTE'), 'T6 anon EXECUTE revoked on v16');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='complete_order_with_payment_v14'), 'T7 v14 dropped');
SELECT * FROM finish();
ROLLBACK;
