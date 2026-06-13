-- supabase/tests/delete_product_v1.test.sql
-- Session 45 / Wave A — pgTAP suite for delete_product_v1 soft-delete RPC.
--
-- Coverage (7 asserts across 6 test cases):
--   T1  happy path   : SUPER_ADMIN soft-deletes active product → is_active=false, deleted=true
--   T2  perm denied  : CASHIER raises 42501 (permission_denied)
--   T2b perm denied  : MANAGER raises 42501 (permission_denied) — products.delete is ADMIN+/SUPER_ADMIN only
--   T3  D2 guard     : parent with ≥1 active child variant → P0001 parent_has_active_variants
--   T4  idempotent   : second call on already-inactive product → idempotent_replay=true, no 2nd audit row
--   T5  audit        : exactly 1 audit_logs row with action='product.deleted' and canonical cols
--   T6  REVOKE       : anon has no EXECUTE on delete_product_v1(uuid, uuid)
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK.
-- pgtap extension is pre-enabled on V3 dev project ikcyvlovptebroadgtvd.
--
-- Auth pattern: set_config('request.jwt.claims', ...) is read by auth.uid() via the
-- PostgREST JWT extraction layer — same pattern as product_variants.test.sql (S27c).
-- Seeded roles: SUPER_ADMIN, CASHIER, MANAGER stable on V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures
-- Lookup seeded auth users by role; create a fresh test product; store IDs
-- in session GUCs for use across DO blocks / SELECT ok() calls.
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
BEGIN
  -- Lookup SUPER_ADMIN (full privileges including products.delete)
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
   WHERE role_code = 'SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'No SUPER_ADMIN user available for delete_product_v1 tests';
  END IF;

  -- Lookup CASHIER (no products.delete)
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles
   WHERE role_code = 'CASHIER' AND deleted_at IS NULL LIMIT 1;
  IF v_cashier_uid IS NULL THEN
    RAISE EXCEPTION 'No CASHIER user available for delete_product_v1 tests';
  END IF;

  -- Lookup MANAGER (products.update but NOT products.delete)
  SELECT auth_user_id INTO v_manager_uid FROM user_profiles
   WHERE role_code = 'MANAGER' AND deleted_at IS NULL LIMIT 1;
  IF v_manager_uid IS NULL THEN
    RAISE EXCEPTION 'No MANAGER user available for delete_product_v1 tests';
  END IF;

  SELECT id INTO v_cat_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_cat_id IS NULL THEN
    RAISE EXCEPTION 'No category available for delete_product_v1 tests';
  END IF;

  -- Fresh standalone product for T1 / T4 / T5 — active, not a variant
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

  -- Fresh parent product for T3 (D2 guard) — active, will have active child
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

  -- Fresh child variant pointing to v_parent_id — active child triggers D2 guard
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

  -- Store IDs in session GUCs
  PERFORM set_config('breakery.s45_admin_uid',   v_admin_uid::TEXT,   false);
  PERFORM set_config('breakery.s45_cashier_uid', v_cashier_uid::TEXT, false);
  PERFORM set_config('breakery.s45_manager_uid', v_manager_uid::TEXT, false);
  PERFORM set_config('breakery.s45_prod_id',     v_prod_id::TEXT,     false);
  PERFORM set_config('breakery.s45_parent_id',   v_parent_id::TEXT,   false);
  PERFORM set_config('breakery.s45_child_id',    v_child_id::TEXT,    false);

  -- Pin SUPER_ADMIN JWT claim for T1 and subsequent happy-path tests
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid::TEXT, 'role', 'authenticated')::TEXT,
    false);
END $fixtures$;

-- ────────────────────────────────────────────────────────────────────────────
-- T1 : SUPER_ADMIN soft-deletes an active product — happy path.
--      Expect: returned JSONB has deleted=true, idempotent_replay=false,
--              and products.is_active IS false.
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
  AND NOT (SELECT is_active FROM products WHERE id = current_setting('breakery.s45_prod_id')::UUID),
  'T1  SUPER_ADMIN soft-deletes active product — deleted=true, is_active=false'
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
-- T3 : D2 guard — parent with ≥1 active child variant → P0001 parent_has_active_variants.
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
-- T4 : Idempotent replay — calling again on already-inactive product.
--      T1 already soft-deleted s45_prod_id. Calling again must:
--      - return idempotent_replay=true
--      - NOT insert a second audit_logs row
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
  'T4  second call on inactive product returns idempotent_replay=true'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T5 : Audit log — exactly ONE audit_logs row with action='product.deleted'.
--      T1 was the successful mutation; T4 was the idempotent replay (no insert).
--      We scope by entity_id AND created_at > beginning of this transaction
--      so pre-existing rows (if any) don't pollute the count.
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
-- T6 : REVOKE — anon has no EXECUTE privilege on delete_product_v1(uuid, uuid).
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  NOT has_function_privilege('anon', 'public.delete_product_v1(uuid, uuid)', 'EXECUTE'),
  'T6  anon has no EXECUTE on delete_product_v1(uuid, uuid)'
);

SELECT * FROM finish();
ROLLBACK;
