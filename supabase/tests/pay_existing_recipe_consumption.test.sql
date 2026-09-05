-- pay_existing_recipe_consumption.test.sql
-- Bug 2026-08-25 — pay_existing_order_v18 : un fini non suivi en stock
-- (track_inventory=false, deduct_stock=true) paye via pay_existing consomme
-- les ingredients de sa recette (_resolve_recipe_consumption_v1, descente
-- ADR-016) et ne touche PAS son propre stock. v17 deduisait le fini lui-meme.
-- Un produit suivi sur la meme commande continue de deduire son stock propre.
--
-- Run via MCP execute_sql under BEGIN/ROLLBACK. Cashier ...0002 has
-- pos.sale.create + payments.process. Captures TAP lines into _cap and
-- returns (failures, total, lines).
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
UPDATE business_config SET allow_negative_stock=true WHERE id=1;
INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('00000000-0000-0000-0000-0000000cf018','00000000-0000-0000-0000-000000000002', 0, 'open');
INSERT INTO products (id, sku, name, category_id, retail_price, product_type, current_stock, track_inventory, deduct_stock, unit) VALUES
  ('00000000-0000-0000-0000-0000000e1801','V18-ING','V18 Ingredient','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',0,'finished',100,true,true,'pcs'),
  ('00000000-0000-0000-0000-0000000e1802','V18-MTO','V18 MadeToOrder','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',5000,'finished',0,false,true,'pcs'),
  ('00000000-0000-0000-0000-0000000e1803','V18-TRK','V18 Tracked','9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a',3000,'finished',10,true,true,'pcs');
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES ('00000000-0000-0000-0000-0000000e1802','00000000-0000-0000-0000-0000000e1801',2,'pcs',true);

-- Fire dine-in (fire persists the lines; deduction happens at pay).
DO $$
DECLARE r jsonb;
BEGIN
  r := fire_counter_order_v7(
    p_client_uuid := '00000000-0000-0000-0000-0000000e18bb'::uuid,
    p_session_id := '00000000-0000-0000-0000-0000000cf018',
    p_items := '[{"product_id":"00000000-0000-0000-0000-0000000e1802","quantity":1,"unit_price":5000,"modifiers":[]},
                 {"product_id":"00000000-0000-0000-0000-0000000e1803","quantity":1,"unit_price":3000,"modifiers":[]}]'::jsonb,
    p_order_type := 'dine_in'::order_type,
    p_table_number := 'V18-T1'
  );
  PERFORM set_config('v18.order_id', r->>'order_id', false);
END $$;

DO $$
DECLARE r jsonb;
BEGIN
  r := pay_existing_order_v19(
    p_order_id := current_setting('v18.order_id')::uuid,
    p_payment := '{"method":"cash","amount":8000,"cash_received":8000,"change_given":0}'::jsonb);
END $$;

SELECT plan(6);
CREATE TEMP TABLE _cap(l text) ON COMMIT DROP;
INSERT INTO _cap SELECT ok(
  (SELECT status::text FROM orders WHERE id=current_setting('v18.order_id')::uuid) = 'paid',
  'order is paid');
INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id='00000000-0000-0000-0000-0000000e1802') = 0,
  'made-to-order product stock untouched (was: deducted to -1 by v17)');
INSERT INTO _cap SELECT ok(
  NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_id='00000000-0000-0000-0000-0000000e1802'),
  'no sale movement on the made-to-order product');
INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id='00000000-0000-0000-0000-0000000e1801') = 98,
  'ingredient stock deducted per recipe (100 - 2x1)');
INSERT INTO _cap SELECT ok(
  EXISTS (SELECT 1 FROM stock_movements
          WHERE product_id='00000000-0000-0000-0000-0000000e1801'
            AND movement_type='sale' AND quantity=-2
            AND reference_id=current_setting('v18.order_id')::uuid),
  'ingredient carries a sale movement referencing the order');
INSERT INTO _cap SELECT ok(
  (SELECT current_stock FROM products WHERE id='00000000-0000-0000-0000-0000000e1803') = 9,
  'tracked product on the same order still deducts its own stock');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l,' | ') AS lines FROM _cap;
ROLLBACK;
