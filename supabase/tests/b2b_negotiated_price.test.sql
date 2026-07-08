-- supabase/tests/b2b_negotiated_price.test.sql
-- S69 Volet B — server-authoritative B2B negotiated pricing.
-- Proves _resolve_b2b_line_price_v1 order (customer > category-custom > retail)
-- and that create_b2b_order_v5 bills the resolved price, ignoring the client unit_price.
-- Run via MCP execute_sql (BEGIN/ROLLBACK).

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

-- Admin identity (EMP000: pos.sale.create + customer_categories.update + customer_prices.manage)
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- Fixtures: a custom category, a B2B customer in it, a non-stock product @ retail 5000.
SELECT create_customer_category_v1('S69 Neg','s69negcat','custom',0,1.0,true,null,null,false);

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES ('b2b69001-0000-0000-0000-000000000001','PGTAP-S69-PROD','pgTAP S69 Product',
        (SELECT id FROM categories LIMIT 1), 5000, 0, 0)
ON CONFLICT (id) DO NOTHING;
UPDATE products SET retail_price=5000, track_inventory=false, deduct_stock=false, is_display_item=false
 WHERE id='b2b69001-0000-0000-0000-000000000001';

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance, category_id)
VALUES ('b2b69002-0000-0000-0000-000000000001','PGTAP S69 Cust','b2b','PT S69', NULL, 0,
        (SELECT id FROM customer_categories WHERE slug='s69negcat'))
ON CONFLICT (id) DO NOTHING;

-- Category override (custom) = 4000, per-customer negotiated = 3000.
SELECT upsert_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='s69negcat'),
  'b2b69001-0000-0000-0000-000000000001', 4000);
SELECT upsert_customer_product_price_v1(
  'b2b69002-0000-0000-0000-000000000001', 'b2b69001-0000-0000-0000-000000000001', 3000);

-- 1. customer negotiated price wins
SELECT is(_resolve_b2b_line_price_v1(
  'b2b69002-0000-0000-0000-000000000001','b2b69001-0000-0000-0000-000000000001')::int,
  3000, 'customer negotiated price wins');

-- 2. remove customer price -> category custom override applies
SELECT delete_customer_product_price_v1(
  'b2b69002-0000-0000-0000-000000000001','b2b69001-0000-0000-0000-000000000001');
SELECT is(_resolve_b2b_line_price_v1(
  'b2b69002-0000-0000-0000-000000000001','b2b69001-0000-0000-0000-000000000001')::int,
  4000, 'category custom override next');

-- 3. remove override -> retail fallback
SELECT delete_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='s69negcat'),
  'b2b69001-0000-0000-0000-000000000001');
SELECT is(_resolve_b2b_line_price_v1(
  'b2b69002-0000-0000-0000-000000000001','b2b69001-0000-0000-0000-000000000001')::int,
  5000, 'retail fallback');

-- 4. create_b2b_order_v5 ignores the client unit_price (send 999999, expect billed at resolved retail 5000)
DO $mk$
DECLARE v_res jsonb;
BEGIN
  v_res := create_b2b_order_v5(
    p_customer_id => 'b2b69002-0000-0000-0000-000000000001',
    p_items => jsonb_build_array(jsonb_build_object(
      'product_id','b2b69001-0000-0000-0000-000000000001','quantity',1,'unit_price',999999)));
  PERFORM set_config('breakery.s69_order', v_res->>'order_id', false);
END $mk$;

SELECT is((SELECT unit_price::int FROM order_items
  WHERE order_id = current_setting('breakery.s69_order')::uuid LIMIT 1),
  5000, 'v5 bills resolved price, ignores client unit_price');
SELECT is((SELECT total::int FROM orders WHERE id = current_setting('breakery.s69_order')::uuid),
  5000, 'v5 order total = resolved price');

SELECT * FROM finish();
ROLLBACK;
