-- S53 P1.4 — sale-stock unification acceptance suite.
-- Helper existence/REVOKE (Task 1) + per-path regression + new-behavior assertions (Tasks 2-4).
BEGIN;
SELECT plan(4);

-- Helper exists with the exact 9-arg signature.
SELECT has_function('public', '_record_sale_stock_v1',
  ARRAY['uuid','numeric','uuid','uuid','text','movement_type','text','text','boolean'],
  'T1: _record_sale_stock_v1 exists (9 args)');

-- Internal-only: no EXECUTE for anon, authenticated, or public.
SELECT ok(NOT has_function_privilege('anon',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T2: anon EXECUTE revoked');
SELECT ok(NOT has_function_privilege('authenticated',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T3: authenticated EXECUTE revoked');
SELECT ok(NOT has_function_privilege('public',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T4: public EXECUTE revoked');

SELECT * FROM finish();
ROLLBACK;
