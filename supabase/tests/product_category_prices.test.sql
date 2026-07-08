-- supabase/tests/product_category_prices.test.sql
-- S69 Volet A — pgTAP suite for category-level product price override RPCs.
-- Auth: ADMIN identity (EMP000) via request.jwt.claims. Run via MCP BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

SELECT create_customer_category_v1('Bulk','bulk','custom',0,1.0,true,null,null,false);

-- upsert insert
SELECT lives_ok($$SELECT upsert_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), 5000)$$, 'insert override');
SELECT is((SELECT price::int FROM product_category_prices
  WHERE customer_category_id=(SELECT id FROM customer_categories WHERE slug='bulk')), 5000, 'price stored');

-- upsert conflict updates in place
SELECT upsert_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), 4200);
SELECT is((SELECT price::int FROM product_category_prices
  WHERE customer_category_id=(SELECT id FROM customer_categories WHERE slug='bulk')), 4200, 'conflict updated');

-- negative price rejected (typed)
SELECT throws_ok($$SELECT upsert_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), -1)$$, 'P0001', NULL, 'negative price rejected');

-- unknown category rejected
SELECT throws_ok($$SELECT upsert_product_category_price_v1(
  gen_random_uuid(), (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), 100)$$,
  'P0002', NULL, 'unknown category rejected');

-- delete removes the override (idempotent)
SELECT lives_ok($$SELECT delete_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1))$$, 'delete override');
SELECT is((SELECT count(*)::int FROM product_category_prices
  WHERE customer_category_id=(SELECT id FROM customer_categories WHERE slug='bulk')), 0, 'override removed');

SELECT * FROM finish();
ROLLBACK;
