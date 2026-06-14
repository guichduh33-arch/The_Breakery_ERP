-- supabase/tests/delete_product_v1.test.sql
-- Session 45 / Wave A (updated by corrective _012) — pgTAP suite for delete_product_v1.
--
-- Coverage (8 asserts across 7 test cases):
--   T1  happy path         : SUPER_ADMIN deletes active product → is_active=false,
--                            deleted_at IS NOT NULL, deleted_at filter excludes it.
--   T2  perm denied        : CASHIER raises 42501 (permission_denied)
--   T2b perm denied        : MANAGER raises 42501 (permission_denied)
--   T3  D2 guard           : parent with ≥1 active child variant → P0001
--   T4  idempotent replay  : second call on already-deleted product → idempotent_replay=true,
--                            no 2nd audit row.
--   T5  audit              : exactly 1 audit_logs row with action='product.deleted'
--   T6  REVOKE             : anon has no EXECUTE on delete_product_v1(uuid, uuid)
--   T7  deactivated-not-deleted: is_active=false but deleted_at NULL → delete still
--                            sets deleted_at + returns idempotent_replay=false.
--                            Proves replay guard keys on deleted_at, NOT is_active.
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.
-- pgtap extension is pre-enabled on V3 dev project ikcyvlovptebroadgtvd.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures
-- ────────────────────────────────────────────────────────────────────────────

DO $fixtures$
DECLARE
  v_admin_uid   UUID;
  v_cashier_uid UUID;
  v_manager_uid UUID;
  v_cat_id      UUID;
  v_prod_id     UUID := gen_random_uuid();
  v_parent_id   UUID := gen_random_uuid();
  v_child_id    UUID := gen_random_uuid();
  v_deact_id    UUID := gen_random_uuid();
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
   WHERE role_code = 'SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'No SUPER_ADMIN user available for delete_product_v1 tests';
  END IF;

  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles
   WHERE role_code = 'CASHIER' AND deleted_at IS NULL LIMIT 1;
  IF v_cashier_uid IS NULL THEN
    RAISE EXCEPTION 'No CASHIER user available for delete_product_v1 tests';
  END IF;

  SELECT auth_user_id INTO v_manager_uid FROM user_profiles
   WHERE role_code = 'MANAGER' AND deleted_at IS NULL LIMIT 1;
  IF v_manager_uid IS NULL THEN
    RAISE EXCEPTION 'No MANAGER user available for delete_product_v1 tests';
  END IF;

  SELECT id INTO v_cat_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_cat_id IS NULL THEN
    RAISE EXCEPTION 'No category available for delete_product_v1 tests';
  END IF;

  -- Fresh standalone product for T1 / T4 / T5 — active
  INSERT INTO products (
    id, name, sku, category_id, unit,
    retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, created_at, updated_at
  ) VALUES (
    v_prod_id, 'PGTAP_S45_DEL_PROD', 'PGTAPS45DEL', v_cat_id, 'pcs',
    10000, 5000,
    true, true, true, true,
    true, now(), now()
  );

  -- Fresh parent product for T3 (D2 guard)
  INSERT INTO products (
    id, name, sku, category_id, unit,
    retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, created_at, updated_at
  ) VALUES (
    v_parent_id, 'PGTAP_S45_PARENT', 'PGTAPS45PAR', v_cat_id, 'pcs',
    15000, 7000,
    true, true, true, true,
    true, now(), now()
  );

  -- Active child variant pointing to v_parent_id — triggers D2 guard
  INSERT INTO products (
    id, name, sku, category_id, unit,
    retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    parent_product_id, variant_label, variant_axis, variant_sort_order,
    is_active, created_at, updated_at
  ) VALUES (
    v_child_id, 'PGTAP_S45_CHILD', 'PGTAPS45CHI', v_cat_id, 'pcs',
    15000, 7000,
    true, true, true, true,
    v_parent_id, 'Default', 'flavor'::variant_axis_type, 10,
    true, now(), now()
  );

  -- Product that is is_active=false but deleted_at IS NULL — simulates a deactivated
  -- (not deleted) product. T7 asserts delete_product_v1 still sets deleted_at.
  INSERT INTO products (
    id, name, sku, category_id, unit,
    retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, created_at, updated_at
  ) VALUES (
    v_deact_id, 'PGTAP_S45_DEACT', 'PGTAPS45DEA', v_cat_id, 'pcs',
    10000, 5000,
    true, true, true, true,
    true, now(), now()
  );
  -- Manually deactivate it without touching deleted_at (simulates BO toggle)
  UPDATE products SET is_active = false, updated_at = now()
   WHERE id = v_deact_id;

  PERFORM set_config('breakery.s45_admin_uid',   v_admin_uid::TEXT,   false);
  PERFORM set_config('breakery.s45_cashier_uid', v_cashier_uid::TEXT, false);
  PERFORM set_config('breakery.s45_manager_uid', v_manager_uid::TEXT, false);
  PERFORM set_config('breakery.s45_prod_id',     v_prod_id::TEXT,     false);
  PERFORM set_config('breakery.s45_parent_id',   v_parent_id::TEXT,   false);
  PERFORM set_config('breakery.s45_child_id',    v_child_id::TEXT,    false);
  PERFORM set_config('breakery.s45_deact_id',    v_deact_id::TEXT,    false);

  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid::TEXT, 'role', 'authenticated')::TEXT,
    false);
END $fixtures$;

-- ────────────────────────────────────────────────────────────────────────────
-- T1 : Happy path — SUPER_ADMIN deletes active product.
--      Expect: is_active=false, deleted_at IS NOT NULL,
--              and a deleted_at IS NULL filter now excludes it.
-- ────────────────────────────────────────────────────────────────────────────

DO $t1$
DECLARE
  v_result JSONB;
BEGIN
  v_result := delete_product_v1(current_setting('breakery.s45_prod_id')::UUID, gen_random_uuid());
  PERFORM set_config('breakery.s45_t1_result', v_result::TEXT, false);
END $t1$;

SELECT ok(
  (current_setting('breakery.s45_t1_result')::JSONB)->>'deleted' = 'true'
  AND (current_setting('breakery.s45_t1_result')::JSONB)->>'idempotent_replay' = 'false'
  AND NOT (SELECT is_active FROM products WHERE id = current_setting('breakery.s45_prod_id')::UUID)
  AND (SELECT deleted_at FROM products WHERE id = current_setting('breakery.s45_prod_id')::UUID) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM products
                   WHERE id = current_setting('breakery.s45_prod_id')::UUID
                     AND deleted_at IS NULL),
  'T1  SUPER_ADMIN deletes active product — is_active=false, deleted_at IS NOT NULL, excluded by catalog filter'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T2 : CASHIER — permission denied (42501).
-- ────────────────────────────────────────────────────────────────────────────

DO $t2_setup$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'sub',  current_setting('breakery.s45_cashier_uid'),
      'role', 'authenticated'
    )::TEXT, false);
END $t2_setup$;

SELECT throws_ok(
  format(
    $q$SELECT delete_product_v1(%L::UUID, gen_random_uuid())$q$,
    current_setting('breakery.s45_prod_id')
  ),
  '42501',
  NULL,
  'T2  CASHIER cannot call delete_product_v1 (42501 permission_denied)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T2b : MANAGER — also permission denied (products.delete is ADMIN+/SUPER_ADMIN only).
-- ────────────────────────────────────────────────────────────────────────────

DO $t2b_setup$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'sub',  current_setting('breakery.s45_manager_uid'),
      'role', 'authenticated'
    )::TEXT, false);
END $t2b_setup$;

SELECT throws_ok(
  format(
    $q$SELECT delete_product_v1(%L::UUID, gen_random_uuid())$q$,
    current_setting('breakery.s45_prod_id')
  ),
  '42501',
  NULL,
  'T2b MANAGER cannot call delete_product_v1 (42501 permission_denied)'
);

-- Reset to SUPER_ADMIN for subsequent tests
DO $reset_admin$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'sub',  current_setting('breakery.s45_admin_uid'),
      'role', 'authenticated'
    )::TEXT, false);
END $reset_admin$;

-- ────────────────────────────────────────────────────────────────────────────
-- T3 : D2 guard — parent with ≥1 active child variant → P0001.
-- ────────────────────────────────────────────────────────────────────────────

SELECT throws_ok(
  format(
    $q$SELECT delete_product_v1(%L::UUID, gen_random_uuid())$q$,
    current_setting('breakery.s45_parent_id')
  ),
  'P0001',
  NULL,
  'T3  parent with active child variant raises P0001 parent_has_active_variants'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T4 : Idempotent replay — second call on already-deleted product (T1 ran it).
--      Expect: idempotent_replay=true, no second audit_logs row.
-- ────────────────────────────────────────────────────────────────────────────

DO $t4$
DECLARE
  v_result JSONB;
BEGIN
  v_result := delete_product_v1(current_setting('breakery.s45_prod_id')::UUID, gen_random_uuid());
  PERFORM set_config('breakery.s45_t4_result', v_result::TEXT, false);
END $t4$;

SELECT ok(
  (current_setting('breakery.s45_t4_result')::JSONB)->>'idempotent_replay' = 'true',
  'T4  second call on deleted product returns idempotent_replay=true'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T5 : Audit — exactly 1 audit_logs row (T1 wrote it; T4 replay did not).
-- ────────────────────────────────────────────────────────────────────────────

SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
    WHERE action      = 'product.deleted'
      AND entity_id   = current_setting('breakery.s45_prod_id')::UUID
      AND entity_type = 'product'
      AND actor_id    = current_setting('breakery.s45_admin_uid')::UUID
      AND created_at  > now() - interval '1 minute'),
  1,
  'T5  exactly 1 audit_logs row with action=product.deleted for this product'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T6 : REVOKE — anon has no EXECUTE privilege.
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  NOT has_function_privilege('anon', 'public.delete_product_v1(uuid, uuid)', 'EXECUTE'),
  'T6  anon has no EXECUTE on delete_product_v1(uuid, uuid)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T7 : Deactivated-not-deleted — is_active=false but deleted_at IS NULL.
--      Calling delete_product_v1 must:
--      - NOT treat this as a replay (replay guard keys on deleted_at, not is_active)
--      - set deleted_at IS NOT NULL
--      - return idempotent_replay=false
--      - insert an audit_logs row
-- ────────────────────────────────────────────────────────────────────────────

DO $t7$
DECLARE
  v_result JSONB;
BEGIN
  v_result := delete_product_v1(current_setting('breakery.s45_deact_id')::UUID, gen_random_uuid());
  PERFORM set_config('breakery.s45_t7_result', v_result::TEXT, false);
END $t7$;

SELECT ok(
  (current_setting('breakery.s45_t7_result')::JSONB)->>'idempotent_replay' = 'false'
  AND (current_setting('breakery.s45_t7_result')::JSONB)->>'deleted' = 'true'
  AND (SELECT deleted_at FROM products WHERE id = current_setting('breakery.s45_deact_id')::UUID) IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM audit_logs
     WHERE action      = 'product.deleted'
       AND entity_id   = current_setting('breakery.s45_deact_id')::UUID
       AND entity_type = 'product'
       AND created_at  > now() - interval '1 minute'
  ),
  'T7  deactivated-but-not-deleted product: delete sets deleted_at, returns idempotent_replay=false, writes audit row'
);

SELECT * FROM finish();
ROLLBACK;
