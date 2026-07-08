-- supabase/tests/customer_product_prices_rls.test.sql
-- S69 Volet B — table shape, RLS/grant lockdown, and permission seed.
-- (Task 6 appends RPC assertions to this file and bumps plan().)
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

-- table exists with expected composite PK
SELECT has_table('customer_product_prices');
SELECT col_is_pk('customer_product_prices', ARRAY['customer_id','product_id'], 'composite PK');

-- authenticated has no direct write (writes go through SECURITY DEFINER RPCs) but can read
SELECT is(has_table_privilege('authenticated','customer_product_prices','INSERT'), false, 'no direct INSERT for authenticated');
SELECT is(has_table_privilege('authenticated','customer_product_prices','SELECT'), true, 'authenticated can SELECT (RLS-gated)');

-- permission seeded (permissions PK is `code`)
SELECT isnt((SELECT code FROM permissions WHERE code = 'customer_prices.manage'), NULL, 'perm seeded');

-- ── Task 6: write RPCs ────────────────────────────────────────────────────
DO $seed$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid, 'role', 'authenticated')::TEXT, true);
END $seed$;

-- upsert insert + verify stored
SELECT lives_ok($$SELECT upsert_customer_product_price_v1(
  (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1),
  (SELECT id FROM products  WHERE deleted_at IS NULL LIMIT 1), 7500)$$, 'upsert negotiated price');
SELECT is((SELECT price::int FROM customer_product_prices
  WHERE customer_id = (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1)), 7500, 'price stored');

-- upsert conflict updates the price in place (ON CONFLICT DO UPDATE branch)
SELECT upsert_customer_product_price_v1(
  (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1),
  (SELECT id FROM products  WHERE deleted_at IS NULL LIMIT 1), 6100);
SELECT is((SELECT price::int FROM customer_product_prices
  WHERE customer_id = (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1)), 6100, 'conflict updated in place');

-- negative rejected (typed)
SELECT throws_ok($$SELECT upsert_customer_product_price_v1(
  (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1),
  (SELECT id FROM products  WHERE deleted_at IS NULL LIMIT 1), -5)$$, 'P0001', NULL, 'negative rejected');

-- unknown customer rejected
SELECT throws_ok($$SELECT upsert_customer_product_price_v1(
  gen_random_uuid(), (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), 100)$$,
  'P0002', NULL, 'unknown customer rejected');

-- delete removes the negotiated price (idempotent)
SELECT lives_ok($$SELECT delete_customer_product_price_v1(
  (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1),
  (SELECT id FROM products  WHERE deleted_at IS NULL LIMIT 1))$$, 'delete negotiated price');

-- ACL: anon cannot execute
SELECT is(has_function_privilege('anon',
  'upsert_customer_product_price_v1(uuid,uuid,numeric)','EXECUTE'), false, 'anon cannot upsert');

SELECT * FROM finish();
ROLLBACK;
