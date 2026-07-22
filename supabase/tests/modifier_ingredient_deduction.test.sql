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
UPDATE business_config SET allow_negative_stock=false WHERE id=1;

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

-- ===== Section C fixtures: void restore (Oat3 / Latte3) =====
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a3', 'RAW-OAT3-P2', 'Oat Milk3 P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order)
VALUES ('00000000-0000-0000-0000-0000000000a3', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000b3', 'FIN-LATTE3-P2', 'Latte3 P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished') ON CONFLICT (id) DO NOTHING;
INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b3', 'Milk', 0, true, 'single_select', 'Oat', 1, 10000, false, true,
  '[{"product_id":"00000000-0000-0000-0000-0000000000a3","qty":30,"unit":"ml"}]'::jsonb) ON CONFLICT DO NOTHING;

-- ===== Section D fixtures: refund restore scaled (Oat4 / Latte4) =====
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a4', 'RAW-OAT4-P2', 'Oat Milk4 P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order)
VALUES ('00000000-0000-0000-0000-0000000000a4', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000b4', 'FIN-LATTE4-P2', 'Latte4 P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished') ON CONFLICT (id) DO NOTHING;
INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b4', 'Milk', 0, true, 'single_select', 'Oat', 1, 10000, false, true,
  '[{"product_id":"00000000-0000-0000-0000-0000000000a4","qty":30,"unit":"ml"}]'::jsonb) ON CONFLICT DO NOTHING;

-- ===== Section E fixtures: DISPLAY-tracked ingredient (Oat5 display_stock 5) =====
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, is_display_item)
VALUES ('00000000-0000-0000-0000-0000000000a5', 'RAW-OAT5-P2', 'Oat Milk5 P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO display_stock (product_id, quantity) VALUES ('00000000-0000-0000-0000-0000000000a5', 5) ON CONFLICT (product_id) DO UPDATE SET quantity=5;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order) VALUES ('00000000-0000-0000-0000-0000000000a5', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000b5', 'FIN-LATTE5-P2', 'Latte5 P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished') ON CONFLICT (id) DO NOTHING;
INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b5', 'Milk', 0, true, 'single_select', 'Oat', 1, 10000, false, true,
  '[{"product_id":"00000000-0000-0000-0000-0000000000a5","qty":30,"unit":"ml"}]'::jsonb) ON CONFLICT DO NOTHING;

-- ===== Section F fixtures: multi-group line (Milk->Oat6 30ml + Syrup->Vanilla6 10ml) =====
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a6', 'RAW-OAT6-P2', 'Oat Milk6 P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order) VALUES ('00000000-0000-0000-0000-0000000000a6', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000c6', 'RAW-VAN6-P2', 'Vanilla6 P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order) VALUES ('00000000-0000-0000-0000-0000000000c6', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000b6', 'FIN-LATTE6-P2', 'Latte6 P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished') ON CONFLICT (id) DO NOTHING;
INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b6', 'Milk', 0, true, 'single_select', 'Oat', 1, 0, false, true, '[{"product_id":"00000000-0000-0000-0000-0000000000a6","qty":30,"unit":"ml"}]'::jsonb),
       ('00000000-0000-0000-0000-0000000000b6', 'Syrup', 1, false, 'single_select', 'Vanilla', 1, 0, false, true, '[{"product_id":"00000000-0000-0000-0000-0000000000c6","qty":10,"unit":"ml"}]'::jsonb)
ON CONFLICT DO NOTHING;

-- ===== Section G fixtures: mid-multi-line oversell -> atomic rollback (Oat7 ok / Oat7b 0.01 L) =====
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000a7', 'RAW-OAT7-P2', 'Oat Milk7 P2', 'L', 0, 100, 5, '00000000-0000-0000-0000-0000000000c1', true, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order) VALUES ('00000000-0000-0000-0000-0000000000a7', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory)
VALUES ('00000000-0000-0000-0000-0000000000d7', 'RAW-OAT7B-P2', 'Oat Milk7b P2', 'L', 0, 100, 0.01, '00000000-0000-0000-0000-0000000000c1', true, true) ON CONFLICT (id) DO NOTHING;
INSERT INTO product_unit_alternatives (product_id, code, factor_to_base, display_order) VALUES ('00000000-0000-0000-0000-0000000000d7', 'ml', 0.001, 1) ON CONFLICT DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000b7', 'FIN-LATTE7-P2', 'Latte7 P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished') ON CONFLICT (id) DO NOTHING;
INSERT INTO products (id, sku, name, unit, retail_price, cost_price, current_stock, category_id, is_active, track_inventory, product_type)
VALUES ('00000000-0000-0000-0000-0000000000e7', 'FIN-LATTE7B-P2', 'Latte7b P2', 'pcs', 30000, 0, 1000, '9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a', true, true, 'finished') ON CONFLICT (id) DO NOTHING;
INSERT INTO product_modifiers (product_id, group_name, group_sort_order, group_required, group_type, option_label, option_sort_order, price_adjustment, is_default, is_active, ingredients_to_deduct)
VALUES ('00000000-0000-0000-0000-0000000000b7', 'Milk', 0, true, 'single_select', 'Oat', 1, 0, false, true, '[{"product_id":"00000000-0000-0000-0000-0000000000a7","qty":30,"unit":"ml"}]'::jsonb),
       ('00000000-0000-0000-0000-0000000000e7', 'Milk', 0, true, 'single_select', 'Oat', 1, 0, false, true, '[{"product_id":"00000000-0000-0000-0000-0000000000d7","qty":30,"unit":"ml"}]'::jsonb)
ON CONFLICT DO NOTHING;

-- ---- Section A: two direct sales ----
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v19(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b1","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]$i$::jsonb,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb);
  PERFORM set_config('p2.order1', r->>'order_id', false);
END $$;
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v19(
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

-- capture the post-fire / pre-pay state (the pay blocks below mutate it)
DO $$
BEGIN
  PERFORM set_config('p2.fire_snapshot',
    (SELECT (modifier_ingredients_deducted->0->>'qty_base')
       FROM order_items WHERE order_id = current_setting('p2.fire1')::uuid), false);
  PERFORM set_config('p2.fire_oat2_mv',
    (SELECT count(*)::text FROM stock_movements
       WHERE product_id = '00000000-0000-0000-0000-0000000000a2' AND movement_type = 'sale'), false);
  PERFORM set_config('p2.fire_oat2_stock',
    (SELECT current_stock::text FROM products WHERE id = '00000000-0000-0000-0000-0000000000a2'), false);
END $$;

-- ---- Section B: pay the fired order (deducts the persisted snapshot, once) ----
DO $$
DECLARE r jsonb;
BEGIN
  r := pay_existing_order_v12(
    p_order_id := current_setting('p2.fire1')::uuid,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb,
    p_idempotency_key := '00000000-0000-0000-0000-0000000000a9'::uuid);
END $$;
-- replay with the SAME idempotency key must NOT deduct again
DO $$
DECLARE r jsonb;
BEGIN
  r := pay_existing_order_v12(
    p_order_id := current_setting('p2.fire1')::uuid,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb,
    p_idempotency_key := '00000000-0000-0000-0000-0000000000a9'::uuid);
END $$;

-- ---- Section C: complete a sale then VOID it (full ingredient restore) ----
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v19(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b3","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]$i$::jsonb,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb);
  PERFORM void_order_rpc_v5((r->>'order_id')::uuid, 'modifier void test', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002');
END $$;

-- ---- Section D: complete a qty-2 sale then PARTIAL refund qty 1 (scaled restore) ----
DO $$
DECLARE r jsonb; oi uuid;
BEGIN
  r := complete_order_with_payment_v19(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b4","quantity":2,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]$i$::jsonb,
    p_payment := '{"method":"cash","amount":80000,"cash_received":80000,"change_given":0}'::jsonb);
  SELECT id INTO oi FROM order_items WHERE order_id = (r->>'order_id')::uuid LIMIT 1;
  PERFORM refund_order_rpc_v6((r->>'order_id')::uuid,
    ('[{"order_item_id":"'||oi||'","qty":1}]')::jsonb,
    '[{"method":"cash","amount":40000}]'::jsonb,
    'modifier refund test', '00000000-0000-0000-0000-000000000004', gen_random_uuid(), '00000000-0000-0000-0000-000000000002');
END $$;

-- ---- Section E: DISPLAY-tracked ingredient — sale deducts display_stock, void restores ----
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v19(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b5","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]$i$::jsonb,
    p_payment := '{"method":"cash","amount":40000,"cash_received":40000,"change_given":0}'::jsonb);
  PERFORM set_config('p2.e_disp_after_sale', (SELECT quantity::text FROM display_stock WHERE product_id='00000000-0000-0000-0000-0000000000a5'), false);
  PERFORM void_order_rpc_v5((r->>'order_id')::uuid, 'display modifier void', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002');
END $$;

-- ---- Section F: one line carrying TWO modifier groups, each deducting its own ingredient ----
DO $$
DECLARE r jsonb;
BEGIN
  r := complete_order_with_payment_v19(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := $i$[{"product_id":"00000000-0000-0000-0000-0000000000b6","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":0},{"group_name":"Syrup","option_label":"Vanilla","price_adjustment":0}]}]$i$::jsonb,
    p_payment := '{"method":"cash","amount":30000,"cash_received":30000,"change_given":0}'::jsonb);
  PERFORM set_config('p2.fmulti', r->>'order_id', false);
END $$;

SELECT plan(24);

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
  SELECT complete_order_with_payment_v19(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000000b1","quantity":200,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":10000}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":8000000,"cash_received":8000000,"change_given":0}'::jsonb)
$q$, 'P0002', NULL, 'T5: insufficient modifier ingredient stock rejected');

-- Section B assertions (fire persists the snapshot, deducts nothing) — captured pre-pay
SELECT is(current_setting('p2.fire_snapshot')::numeric, 0.03, 'T6: fired order snapshot qty_base = 0.03');
SELECT is(current_setting('p2.fire_oat2_mv')::int, 0, 'T7: fire deducts no ingredient stock (no sale movement for Oat2)');
SELECT is(current_setting('p2.fire_oat2_stock')::numeric, 5::numeric, 'T8: Oat Milk2 current_stock unchanged at fire (5)');

-- Section B pay assertions (deduct from snapshot, exactly once incl. replay)
SELECT is(
  (SELECT count(*) FROM stock_movements
     WHERE product_id = '00000000-0000-0000-0000-0000000000a2'
       AND movement_type = 'sale'
       AND reference_id = current_setting('p2.fire1')::uuid),
  1::bigint, 'T9: pay deducts Oat2 exactly once (replay does not double)');
SELECT is(
  (SELECT current_stock FROM products WHERE id = '00000000-0000-0000-0000-0000000000a2'),
  4.97, 'T10: Oat Milk2 current_stock 5 -> 4.97 after pay');
SELECT is(
  (SELECT quantity FROM stock_movements
     WHERE product_id = '00000000-0000-0000-0000-0000000000a2'
       AND movement_type = 'sale'
       AND reference_id = current_setting('p2.fire1')::uuid),
  -0.03, 'T11: pay sale movement for Oat2 = -0.03');

-- Section C assertions (void restores the full ingredient deduction)
SELECT is(
  (SELECT current_stock FROM products WHERE id = '00000000-0000-0000-0000-0000000000a3'),
  5::numeric, 'T12: void restores Oat Milk3 to 5 (4.97 + 0.03)');
SELECT ok(
  EXISTS (SELECT 1 FROM stock_movements
    WHERE product_id = '00000000-0000-0000-0000-0000000000a3'
      AND movement_type = 'sale_void' AND quantity = 0.03),
  'T13: void sale_void +0.03 movement for Oat Milk3');

-- Section D assertions (refund restores scaled by the refunded fraction)
SELECT is(
  (SELECT current_stock FROM products WHERE id = '00000000-0000-0000-0000-0000000000a4'),
  4.97, 'T14: refund qty1of2 restores Oat Milk4 4.94 -> 4.97 (0.06 * 1/2)');
SELECT ok(
  EXISTS (SELECT 1 FROM stock_movements
    WHERE product_id = '00000000-0000-0000-0000-0000000000a4'
      AND movement_type = 'sale_void' AND quantity = 0.03),
  'T15: refund sale_void +0.03 (scaled) movement for Oat Milk4');

-- Section E assertions (display-tracked ingredient: deduct + restore via display_stock)
SELECT is(current_setting('p2.e_disp_after_sale')::numeric, 4.97, 'E1: display sale decremented Oat Milk5 display_stock 5 -> 4.97');
SELECT is(
  (SELECT quantity FROM display_stock WHERE product_id = '00000000-0000-0000-0000-0000000000a5'),
  5::numeric, 'E2: void restored Oat Milk5 display_stock back to 5');
SELECT ok(
  EXISTS (SELECT 1 FROM display_movements WHERE product_id='00000000-0000-0000-0000-0000000000a5' AND movement_type='sale')
  AND EXISTS (SELECT 1 FROM display_movements WHERE product_id='00000000-0000-0000-0000-0000000000a5' AND movement_type='adjustment'),
  'E3: display ingredient wrote both sale and adjustment display_movements');

-- Section F assertions (multi-group line: both ingredients resolved + deducted)
SELECT is(
  (SELECT jsonb_array_length(modifier_ingredients_deducted) FROM order_items WHERE order_id = current_setting('p2.fmulti')::uuid),
  2, 'F1: multi-group line snapshot has 2 ingredient entries');
SELECT is((SELECT current_stock FROM products WHERE id='00000000-0000-0000-0000-0000000000a6'), 4.97, 'F2: Milk ingredient Oat6 5 -> 4.97 (30ml)');
SELECT is((SELECT current_stock FROM products WHERE id='00000000-0000-0000-0000-0000000000c6'), 4.99, 'F3: Syrup ingredient Vanilla6 5 -> 4.99 (10ml)');

-- Section G assertions (mid-multi-line oversell rejected before any write -> atomic)
SELECT throws_ok($q$
  SELECT complete_order_with_payment_v19(
    p_session_id := '00000000-0000-0000-0000-00000000e201', p_order_type := 'take_out'::order_type,
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000000b7","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":0}]},{"product_id":"00000000-0000-0000-0000-0000000000e7","quantity":1,"unit_price":30000,"modifiers":[{"group_name":"Milk","option_label":"Oat","price_adjustment":0}]}]'::jsonb,
    p_payment := '{"method":"cash","amount":60000,"cash_received":60000,"change_given":0}'::jsonb)
$q$, 'P0002', NULL, 'G1: oversold ingredient on line 2 rejects the whole order');
SELECT is((SELECT current_stock FROM products WHERE id='00000000-0000-0000-0000-0000000000a7'), 5::numeric, 'G2: line 1 ingredient (Oat7) untouched after rollback');

SELECT * FROM finish();
ROLLBACK;
