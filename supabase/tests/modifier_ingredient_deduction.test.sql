-- supabase/tests/modifier_ingredient_deduction.test.sql
-- Phase 2 — order-time modifier ingredient stock deduction (money path).
-- Cashier ...0002 has pos.sale.create. Fresh fixtures + open session seeded in-tx.
-- Each behavioural section uses its OWN raw material so stock math stays independent.
--   Section A (complete sale): Oat Milk a1 / Latte b1
--   Section B (fire, no deduct): Oat Milk a2 / Latte b2
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);

-- ---- shared session ----
INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
VALUES ('00000000-0000-0000-0000-00000000e201','00000000-0000-0000-0000-000000000002', 0, 'open')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categories (id, name, slug, category_type, is_active)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'RM P2', 'rm-p2', 'raw_material', true)
ON CONFLICT (id) DO NOTHING;

-- ===== Section A fixtures: complete-sale path =====
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'RAW-OAT-P2', 'Oat Milk P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'FIN-LATTE-P2', 'Latte P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished')
ON CONFLICT (id) DO NOTHING;
INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'Milk', 0, true, 'single_select', 'Oat', 1, 10000, false, true,
  '[{"product_id":"00000000-0000-0000-0000-0000000000a1","qty":30,"unit":"ml"}]'::jsonb) ON CONFLICT DO NOTHING;

-- ===== Section B fixtures: fire path (no deduction at fire) =====
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'RAW-OAT2-P2', 'Oat Milk2 P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true)
ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000b2', 'FIN-LATTE2-P2', 'Latte2 P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished')
ON CONFLICT (id) DO NOTHING;
INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b2', 'Milk', 0, true, 'single_select', 'Oat', 1, 10000, false, true,
  '[{"product_id":"00000000-0000-0000-0000-0000000000a2","qty":30,"unit":"ml"}]'::jsonb) ON CONFLICT DO NOTHING;

-- ---- Section A: two direct sales ----
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v14(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b1","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]$i$::jsonb,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb);
  PERFORM set_config('p2.order1', r->>'order_id', false);
END $$;
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v14(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b1","quantity":1,"unit_price":30000,"modifiers":[]}]$i$::jsonb,
    p_payment := '{"method":"cash","amount":30000,"cash_received":30000,"change_given":0}'::jsonb);
  PERFORM set_config('p2.order2', r->>'order_id', false);
END $$;

-- ---- Section B: fire a counter order (Latte2 + Oat) ----
DO $$
DECLARE r jsonb;
BEGIN
  r := fire_counter_order_v4(
    p_client_uuid := '00000000-0000-0000-0000-0000000f1e01'::uuid,
    p_session_id  := '00000000-0000-0000-0000-00000000e201',
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b2","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]$i$::jsonb,
    p_order_type := 'take_out'::order_type);
  PERFORM set_config('p2.fire1', r->>'order_id', false);
END $$;

SELECT plan(9);

-- Section A assertions
SELECT has_column('public', 'order_items', 'modifier_ingredients_deducted',
  'T0: order_items has modifier_ingredients_deducted snapshot column');
SELECT is(
  (SELECT (modifier_ingredients_deducted->0->>'qty_base')::numeric
     FROM order_items WHERE order_id = current_setting('p2.order1')::uuid),
  0.03, 'T1: order1 snapshot qty_base = 0.03 (ml->L)');
SELECT ok(
  EXISTS (SELECT 1 FROM stock_movements
    WHERE product_id = '00000000-0000-0000-0000-0000000000a1'
      AND movement_type = 'sale' AND quantity = -0.03
      AND reference_id = current_setting('p2.order1')::uuid),
  'T2: Oat Milk sale movement -0.03 recorded');
SELECT is(
  (SELECT current_stock FROM products WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  4.97, 'T3: Oat Milk current_stock 5 -> 4.97');
SELECT ok(
  (SELECT modifier_ingredients_deducted IS NULL
     FROM order_items WHERE order_id = current_setting('p2.order2')::uuid),
  'T4: no-modifier line -> NULL snapshot');
SELECT throws_ok($q$
  SELECT complete_order_with_payment_v14(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000000b1","quantity":200,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":8000000,"cash_received":8000000,"change_given":0}'::jsonb)
$q$, 'P0002', NULL, 'T5: insufficient modifier ingredient stock rejected');

-- Section B assertions (fire persists the snapshot, deducts nothing)
SELECT is(
  (SELECT (modifier_ingredients_deducted->0->>'qty_base')::numeric
     FROM order_items WHERE order_id = current_setting('p2.fire1')::uuid),
  0.03, 'T6: fired order snapshot qty_base = 0.03');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM stock_movements
    WHERE product_id = '00000000-0000-0000-0000-0000000000a2' AND movement_type = 'sale'),
  'T7: fire deducts no ingredient stock (no sale movement for Oat2)');
SELECT is(
  (SELECT current_stock FROM products WHERE id = '00000000-0000-0000-0000-0000000000a2'),
  5::numeric, 'T8: Oat Milk2 current_stock unchanged at fire (5)');

SELECT * FROM finish();
ROLLBACK;
