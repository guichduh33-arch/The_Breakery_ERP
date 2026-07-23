-- supabase/tests/set_product_is_test.test.sql
-- ADR-007 déc. 6 — pgTAP suite for set_product_is_test_v1 (migration _205).
--
-- Coverage (5 asserts) :
--   T1  ADMIN happy path : is_test flips to true, RPC echoes the new value
--   T2  flag back to false (round-trip, pas d'état résiduel)
--   T3  MANAGER (products.update mais PAS products.test_flag.update) → 42501
--   T4  unknown product_id → P0002 product_not_found
--   T5  audit_logs : 2 rows action='product.set_test_flag' (T1+T2)
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

-- Fixtures : un ADMIN (EMP000 super-admin proxy), un MANAGER, un produit vivant.
DO $$
DECLARE
  v_admin_uid UUID;
  v_manager_uid UUID;
  v_product_id UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
   WHERE employee_code = 'EMP000' LIMIT 1;
  SELECT auth_user_id INTO v_manager_uid FROM user_profiles
   WHERE role_code = 'MANAGER' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_product_id FROM products
   WHERE deleted_at IS NULL AND is_test = false ORDER BY sku LIMIT 1;
  IF v_admin_uid IS NULL OR v_manager_uid IS NULL OR v_product_id IS NULL THEN
    RAISE EXCEPTION 'fixture missing (admin=%, manager=%, product=%)',
      v_admin_uid, v_manager_uid, v_product_id;
  END IF;
  PERFORM set_config('breakery.t205_admin_uid', v_admin_uid::TEXT, false);
  PERFORM set_config('breakery.t205_manager_uid', v_manager_uid::TEXT, false);
  PERFORM set_config('breakery.t205_product_id', v_product_id::TEXT, false);
END $$;

-- T1 : ADMIN pose le flag.
DO $t1$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.t205_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
  v_result := set_product_is_test_v1(
    current_setting('breakery.t205_product_id')::UUID, true);
  PERFORM set_config('breakery.t205_t1_echo', (v_result->>'is_test'), false);
  PERFORM set_config('breakery.t205_t1_db',
    (SELECT is_test::TEXT FROM products
      WHERE id = current_setting('breakery.t205_product_id')::UUID), false);
END $t1$;

SELECT ok(
  current_setting('breakery.t205_t1_echo')::BOOLEAN
  AND current_setting('breakery.t205_t1_db')::BOOLEAN,
  'T1 ADMIN sets is_test=true (RPC echo + DB row)'
);

-- T2 : round-trip retour à false.
DO $t2$
DECLARE
  v_result JSONB;
BEGIN
  v_result := set_product_is_test_v1(
    current_setting('breakery.t205_product_id')::UUID, false);
  PERFORM set_config('breakery.t205_t2_db',
    (SELECT is_test::TEXT FROM products
      WHERE id = current_setting('breakery.t205_product_id')::UUID), false);
END $t2$;

SELECT ok(
  NOT current_setting('breakery.t205_t2_db')::BOOLEAN,
  'T2 ADMIN sets is_test back to false (round-trip)'
);

-- T3 : MANAGER (a products.update, PAS products.test_flag.update) → 42501.
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.t205_manager_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

SELECT throws_ok(
  format($q$SELECT set_product_is_test_v1(%L::UUID, true)$q$,
         current_setting('breakery.t205_product_id')),
  '42501',
  'permission_denied',
  'T3 MANAGER cannot set the test flag (42501)'
);

-- T4 : produit inconnu → P0002 (repasse ADMIN).
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.t205_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

SELECT throws_ok(
  $q$SELECT set_product_is_test_v1('00000000-0000-0000-0000-deadbeefdead'::UUID, true)$q$,
  'P0002',
  'product_not_found',
  'T4 unknown product raises P0002'
);

-- T5 : 2 lignes d'audit (T1+T2).
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
    WHERE action = 'product.set_test_flag'
      AND entity_id = current_setting('breakery.t205_product_id')::UUID
      AND created_at > now() - interval '1 minute'),
  2,
  'T5 audit_logs has 2 product.set_test_flag rows (T1+T2)'
);

SELECT * FROM finish();
ROLLBACK;
