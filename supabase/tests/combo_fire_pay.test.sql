-- supabase/tests/combo_fire_pay.test.sql
-- Session 47 / fire-path extension — fire_counter_order_v4 + pay_existing_order_v11
-- combo-aware. Cashier ...0002 has pos.sale.create + payments.process.
-- Fire a combo (persists combo_components), then pay → component stock deducted,
-- combo product stock untouched.
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);

INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('00000000-0000-0000-0000-0000000cf001','00000000-0000-0000-0000-000000000002', 0, 'open');

INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, combo_base_price) VALUES
  ('00000000-0000-0000-0000-0000000cc001','S47-FP-CB','S47 FirePay Combo','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',0,'combo',0,false,50000),
  ('00000000-0000-0000-0000-0000000fc001','S47-FP-F1','S47 FP Comp1','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL),
  ('00000000-0000-0000-0000-0000000fc002','S47-FP-F2','S47 FP Comp2','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',15000,'finished',100,true,NULL);

-- 1) Fire the combo to the counter (persists order_items + combo_components).
DO $$
DECLARE r jsonb;
BEGIN
  r := fire_counter_order_v4(
    p_client_uuid := '00000000-0000-0000-0000-0000000cfaaa'::uuid,
    p_session_id := '00000000-0000-0000-0000-0000000cf001',
    p_items := $items$[
      {"product_id":"00000000-0000-0000-0000-0000000cc001","quantity":1,"unit_price":50000,
       "modifiers":[{"group_name":"Drinks","option_label":"Americano","price_adjustment":0}],
       "combo_components":[{"product_id":"00000000-0000-0000-0000-0000000fc001","quantity":1},
                           {"product_id":"00000000-0000-0000-0000-0000000fc002","quantity":1}]}
    ]$items$::jsonb,
    p_order_type := 'dine_in'::order_type,
    p_table_number := 'CFP-T1'  -- S77: garde table_required_for_dine_in (_122)
  );
  PERFORM set_config('combo.fp_order_id', r->>'order_id', false);
END $$;

SELECT plan(8);

-- Fire persisted the snapshot, no stock moved yet.
SELECT ok((SELECT combo_components IS NOT NULL FROM order_items WHERE order_id=current_setting('combo.fp_order_id')::uuid),
  'T1 fire persisted combo_components snapshot');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fc001'), 100,
  'T2 component stock untouched by fire');

-- 2) Pay the fired counter order.
DO $$
DECLARE r jsonb;
BEGIN
  r := pay_existing_order_v11(
    p_order_id := current_setting('combo.fp_order_id')::uuid,
    p_payment := '{"method":"cash","amount":50000,"cash_received":50000,"change_given":0}'::jsonb
  );
END $$;

SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000cc001'), 0,
  'T3 combo product stock still 0 after pay (virtual)');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fc001'), 99,
  'T4a component1 deducted -1 at pay');
SELECT is((SELECT current_stock::int FROM products WHERE id='00000000-0000-0000-0000-0000000fc002'), 99,
  'T4b component2 deducted -1 at pay');
SELECT is((SELECT status::text FROM orders WHERE id=current_setting('combo.fp_order_id')::uuid), 'paid',
  'T5 order paid');

-- Hardening checks.
SELECT ok(NOT has_function_privilege('anon','pay_existing_order_v11(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb)','EXECUTE'),
  'T6 anon EXECUTE revoked on pay_existing_order_v11');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='pay_existing_order_v9'),
  'T7 pay_existing_order_v9 dropped');

SELECT * FROM finish();
ROLLBACK;
