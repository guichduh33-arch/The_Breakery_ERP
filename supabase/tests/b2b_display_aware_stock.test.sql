-- b2b_display_aware_stock.test.sql
-- S53 P1.4 — create_b2b_order_v5 is display-aware: a display item (is_display_item) sold via a
-- B2B order now decrements display_stock AND appends a display_movements row (reference_type='order'),
-- via _record_sale_stock_v1. v2 did NOT touch display tables — this closes that inconsistency.
--
-- Run via MCP execute_sql under BEGIN/ROLLBACK. Auth simulated via request.jwt.claim.sub (EMP000).
-- The suite captures each assertion's TAP line into _cap and returns (failures, total, lines).
BEGIN;
SELECT plan(3);
SELECT set_config('request.jwt.claim.sub', (SELECT auth_user_id::text FROM user_profiles WHERE employee_code='EMP000'), true);

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance)
VALUES ('ccc40001-0000-0000-0000-000000000001','T4 B2B Unlimited','b2b','PT T4', NULL, 0)
ON CONFLICT (id) DO NOTHING;
UPDATE customers SET b2b_credit_limit = NULL, b2b_current_balance = 0 WHERE id = 'ccc40001-0000-0000-0000-000000000001';

-- Display product: is_display_item=true, tracked. A trigger auto-creates its display_stock row; set it to 5.
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold, track_inventory, deduct_stock, unit, is_display_item)
VALUES ('ddd40003-0000-0000-0000-000000000003','T4-DISPLAY','T4 Display',(SELECT id FROM categories LIMIT 1),10000,100,0,true,false,'pcs',true)
ON CONFLICT (id) DO NOTHING;
UPDATE products SET current_stock=100, track_inventory=true, deduct_stock=false, is_display_item=true WHERE id='ddd40003-0000-0000-0000-000000000003';
INSERT INTO display_stock (product_id, quantity) VALUES ('ddd40003-0000-0000-0000-000000000003', 5)
  ON CONFLICT (product_id) DO UPDATE SET quantity=5;
UPDATE business_config SET allow_negative_stock=false;

CREATE TEMP TABLE _r(name text PRIMARY KEY, pass boolean) ON COMMIT DROP;
DO $d$ DECLARE v jsonb; BEGIN
  v := create_b2b_order_v5('ccc40001-0000-0000-0000-000000000001',
        jsonb_build_array(jsonb_build_object('product_id','ddd40003-0000-0000-0000-000000000003','quantity',2,'unit_price',10000)),
        NULL, NULL, gen_random_uuid());
  INSERT INTO _r VALUES ('order', (v->>'order_id') IS NOT NULL);
  INSERT INTO _r VALUES ('disp',  (SELECT quantity FROM display_stock WHERE product_id='ddd40003-0000-0000-0000-000000000003') = 3);
  INSERT INTO _r VALUES ('mov',   (SELECT count(*) FROM display_movements WHERE product_id='ddd40003-0000-0000-0000-000000000003' AND reference_id=(v->>'order_id')::uuid) = 1);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('order', false); INSERT INTO _r VALUES ('disp', false); INSERT INTO _r VALUES ('mov', false);
END $d$;

CREATE TEMP TABLE _cap(l text);
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='order'), 'B2B display order succeeds via create_b2b_order_v5');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='disp'),  'display_stock decremented 5->3 (B2B now display-aware)');
INSERT INTO _cap SELECT ok((SELECT pass FROM _r WHERE name='mov'),   'one display_movements row for the B2B display sale');
SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l,' | ') AS lines FROM _cap;
ROLLBACK;
