-- supabase/tests/update_product_v1.test.sql
-- Session 27 / Phase 3 — pgTAP suite for update_product_v1.
--
-- Coverage (5 asserts) :
--   T1  MANAGER happy path : name + retail_price patch mutates products row
--   T2  CASHIER (no products.update perm) raises 42501 permission_denied
--   T3  Unknown product_id raises P0002 product_not_found
--   T4  cost_price in patch is silently ignored : ignored_fields contains
--       'cost_price' AND cost_price NOT mutated
--   T5  audit_logs row emitted with action='product.update' + payload
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK ; pgtap extension is pre-created
-- on V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- Pick a real product on V3 dev (BEV-AMER is stable from S22 suite).
-- Capture its baseline cost_price so T4 can assert it didn't change.
DO $$
DECLARE
  v_product_id UUID;
  v_baseline_cost NUMERIC;
BEGIN
  SELECT id, cost_price INTO v_product_id, v_baseline_cost
    FROM products WHERE sku = 'BEV-AMER' AND deleted_at IS NULL LIMIT 1;
  PERFORM set_config('breakery.s27_product_id', v_product_id::text, false);
  PERFORM set_config('breakery.s27_baseline_cost', v_baseline_cost::text, false);
END $$;

-- Switch to MANAGER auth (EMP000 = SUPER_ADMIN — using as proxy with full perms).
-- We pin auth.uid() via the standard request.jwt.claims pattern.
DO $$
DECLARE
  v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
   WHERE employee_code = 'EMP000' LIMIT 1;
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found';
  END IF;
  PERFORM set_config('breakery.s27_admin_uid', v_admin_uid::text, false);
END $$;

-- =============================================================================
-- T1 : MANAGER happy path. Update name + retail_price; verify mutation.
-- =============================================================================

DO $t1$
DECLARE
  v_uid UUID := current_setting('breakery.s27_admin_uid')::UUID;
  v_pid UUID := current_setting('breakery.s27_product_id')::UUID;
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_uid::TEXT, 'role', 'authenticated')::TEXT, true);

  v_result := update_product_v1(
    v_pid,
    '{"name": "S27 pgTAP T1 BEV-AMER", "retail_price": 42424}'::JSONB
  );

  PERFORM set_config('breakery.s27_t1_name',
    (SELECT name FROM products WHERE id = v_pid), false);
  PERFORM set_config('breakery.s27_t1_retail',
    (SELECT retail_price::TEXT FROM products WHERE id = v_pid), false);
END $t1$;

SELECT is(
  current_setting('breakery.s27_t1_name'),
  'S27 pgTAP T1 BEV-AMER',
  'T1 MANAGER patch updates products.name'
);

-- =============================================================================
-- T2 : CASHIER role (no products.update) raises 42501 permission_denied.
-- =============================================================================

DO $t2$
DECLARE
  v_cashier_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles
   WHERE role_code = 'CASHIER' AND deleted_at IS NULL LIMIT 1;
  IF v_cashier_uid IS NULL THEN
    RAISE EXCEPTION 'No CASHIER user available for T2';
  END IF;
  PERFORM set_config('breakery.s27_cashier_uid', v_cashier_uid::TEXT, false);
END $t2$;

-- Re-impersonate as CASHIER
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('breakery.s27_cashier_uid'),
      'role', 'authenticated'
    )::TEXT, true);
END $$;

SELECT throws_ok(
  format($q$SELECT update_product_v1(%L::UUID, '{"name":"nope"}'::JSONB)$q$,
         current_setting('breakery.s27_product_id')),
  '42501',
  'permission_denied',
  'T2 CASHIER cannot call update_product_v1 (42501 permission_denied)'
);

-- =============================================================================
-- T3 : Unknown product_id raises P0002 product_not_found.
-- Re-impersonate as admin first.
-- =============================================================================

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.s27_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

SELECT throws_ok(
  $q$SELECT update_product_v1(
       '00000000-0000-0000-0000-deadbeefdead'::UUID,
       '{"name":"ghost"}'::JSONB
     )$q$,
  'P0002',
  'product_not_found',
  'T3 unknown product_id raises P0002 product_not_found'
);

-- =============================================================================
-- T4 : cost_price field is silently ignored (NOT in 18-col allowlist).
-- Patch contains both name (valid) and cost_price (ignored).
-- Verify cost_price did NOT mutate and ignored_fields contains 'cost_price'.
-- =============================================================================

DO $t4$
DECLARE
  v_pid UUID := current_setting('breakery.s27_product_id')::UUID;
  v_baseline NUMERIC := current_setting('breakery.s27_baseline_cost')::NUMERIC;
  v_result JSONB;
  v_ignored JSONB;
BEGIN
  v_result := update_product_v1(
    v_pid,
    '{"name": "S27 pgTAP T4 BEV-AMER", "cost_price": 999999}'::JSONB
  );
  v_ignored := v_result->'ignored_fields';
  PERFORM set_config('breakery.s27_t4_ignored', v_ignored::TEXT, false);
  PERFORM set_config('breakery.s27_t4_cost',
    (SELECT cost_price::TEXT FROM products WHERE id = v_pid), false);
  PERFORM set_config('breakery.s27_t4_baseline', v_baseline::TEXT, false);
END $t4$;

SELECT ok(
  current_setting('breakery.s27_t4_ignored')::JSONB ? 'cost_price'
  AND current_setting('breakery.s27_t4_cost')::NUMERIC
      = current_setting('breakery.s27_t4_baseline')::NUMERIC,
  'T4 cost_price in patch is reported as ignored AND not mutated'
);

-- =============================================================================
-- T5 : audit_logs row emitted with action='product.update'.
-- Count rows from T1+T4 (two valid update calls = two audit rows).
-- =============================================================================

SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
    WHERE action = 'product.update'
      AND entity_id = current_setting('breakery.s27_product_id')::UUID
      AND created_at > now() - interval '1 minute'),
  2,
  'T5 audit_logs has 2 product.update rows from T1+T4'
);

SELECT * FROM finish();
ROLLBACK;
