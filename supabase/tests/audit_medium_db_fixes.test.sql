-- supabase/tests/audit_medium_db_fixes.test.sql
-- Regression guards for the 2026-06-01 back-office integrity audit DB Medium fixes:
--   M1 : update_account_active_v1 blocks re-activating account 1151 (ADR-003 NON-PKP)
--   M2 : calculate_pb1_payable_v1 sums status IN ('posted','locked')
--   M8 : create_variant_v1 raises a clean sku_taken on duplicate SKU
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- M1: SUPER_ADMIN cannot re-activate account 1151 (ADR-003 NON-PKP guard)
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SELECT throws_ok(
  $$ SELECT update_account_active_v1((SELECT id FROM accounts WHERE code='1151'), true) $$,
  'P0001', NULL,
  'M1 : re-activating account 1151 raises (ADR-003 NON-PKP guard)'
);

-- M1: deactivating 1151 still allowed (no-op since already inactive)
SELECT is(
  (SELECT (update_account_active_v1((SELECT id FROM accounts WHERE code='1151'), false))->>'no_op'),
  'true',
  'M1 : deactivate 1151 still allowed (no-op, already inactive)'
);

-- M2: calculate_pb1_payable_v1 body sums status IN (posted, locked)
SELECT ok(
  pg_get_functiondef('calculate_pb1_payable_v1(date,date)'::regprocedure) LIKE '%''posted'', ''locked''%',
  'M2 : calculate_pb1_payable_v1 sums status IN (posted, locked)'
);

-- M8: duplicate SKU on create_variant_v1 raises sku_taken (P0004)
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000001"}';
SELECT throws_ok(
  $$ SELECT create_variant_v1(
       (SELECT parent_product_id FROM products WHERE parent_product_id IS NOT NULL AND deleted_at IS NULL LIMIT 1),
       'Dup', 'PAS-CROI', 1000) $$,
  'P0004', NULL,
  'M8 : duplicate SKU raises sku_taken (P0004)'
);

SELECT * FROM finish();
ROLLBACK;
