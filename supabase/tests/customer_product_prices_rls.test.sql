-- supabase/tests/customer_product_prices_rls.test.sql
-- S69 Volet B — table shape, RLS/grant lockdown, and permission seed.
-- (Task 6 appends RPC assertions to this file and bumps plan().)
-- Run via MCP execute_sql wrapped BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

-- table exists with expected composite PK
SELECT has_table('customer_product_prices');
SELECT col_is_pk('customer_product_prices', ARRAY['customer_id','product_id'], 'composite PK');

-- authenticated has no direct write (writes go through SECURITY DEFINER RPCs) but can read
SELECT is(has_table_privilege('authenticated','customer_product_prices','INSERT'), false, 'no direct INSERT for authenticated');
SELECT is(has_table_privilege('authenticated','customer_product_prices','SELECT'), true, 'authenticated can SELECT (RLS-gated)');

-- permission seeded (permissions PK is `code`)
SELECT isnt((SELECT code FROM permissions WHERE code = 'customer_prices.manage'), NULL, 'perm seeded');

SELECT * FROM finish();
ROLLBACK;
