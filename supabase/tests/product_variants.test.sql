-- supabase/tests/product_variants.test.sql
-- Session 27c / Wave 4 — pgTAP suite for product variants (Approach A "Linked Products").
--
-- Coverage (18 asserts) :
--   T1   convert_product_to_parent_v1 happy path returns UUID                 (SUPER_ADMIN)
--   T1b  audit_logs row 'products.variant.parent_created' exists
--   T2   convert_product_to_parent_v1 refuses already-variant                 (P0004)
--   T3   convert_product_to_parent_v1 as CASHIER raises forbidden             (P0003)
--   T4   create_variant_v1 happy path returns UUID + inherits unit from parent
--   T5   create_variant_v1 rejects duplicate SKU                              (23505)
--   T6   update_variant_v1 patches retail_price + variant_label
--   T6b  retail_price actually mutated to 1500
--   T7   delete_variant_v1 returns the variant id (soft delete)
--   T7b  is_active flipped to false
--   T8   delete_variant_v1 refuses last remaining active variant              (P0004)
--   T9   reorder_variants_v1 happy with 2 variants returns 2
--   T10  reorder_variants_v1 rejects incomplete coverage                      (P0004)
--   T11  convert_parent_to_standalone_v1 refuses with >1 active variant       (P0004)
--   T12  convert_parent_to_standalone_v1 happy with exactly 1 active variant
--   T12b dissolved variant flipped to standalone (parent_product_id IS NULL)
--   T13  Anti-nesting trigger rejects "parent already a variant"              (P0004)
--   T14  CHECK products_variant_xor rejects partial NULL                      (23514)
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK so fixtures are rolled back.
-- pgtap extension is pre-enabled on V3 dev.
--
-- Permission gates : we impersonate via `request.jwt.claims->>'sub'` which
-- `auth.uid()` reads. The seeded users 00000000-0000-0000-0000-000000000001
-- (SUPER_ADMIN) and 00000000-0000-0000-0000-000000000002 (CASHIER) are stable
-- across the V3 dev project.
--
-- Two notable adaptations from the plan draft (see DEV-S27C-4.A-01/02 in the
-- session-end report) :
--   1. T12 uses a fresh single-variant parent (instead of soft-deleting var3
--      then dissolving) — the plan's flow would hit a real RPC bug where
--      convert_parent_to_standalone_v1 NULLs only parent_product_id on
--      soft-deleted siblings, leaving variant_label/axis partial-NULL and
--      violating the XOR CHECK. The bug is flagged in the report for the
--      controller to triage.
--   2. T14 uses a fresh standalone product as the referenced parent_product_id
--      rather than reusing the variant from T13 — BEFORE INSERT triggers
--      fire before CHECK constraints, so a variant UUID would surface P0004
--      (anti-nesting trigger) instead of the 23514 (XOR CHECK) we want.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(18);

-- ────────────────────────────────────────────────────────────────────────────
-- Fixtures
-- ────────────────────────────────────────────────────────────────────────────
--
-- We create a fresh test product on the Beverage category, capture user uids,
-- and pin the admin claim for all subsequent RPC calls.

DO $fixtures$
DECLARE
  v_admin_uid   UUID;
  v_cashier_uid UUID;
  v_cat_id      UUID;
  v_prod_id     UUID := gen_random_uuid();
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
   WHERE role_code = 'SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'No SUPER_ADMIN user available for tests';
  END IF;

  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles
   WHERE role_code = 'CASHIER' AND deleted_at IS NULL LIMIT 1;
  IF v_cashier_uid IS NULL THEN
    RAISE EXCEPTION 'No CASHIER user available for tests';
  END IF;

  SELECT id INTO v_cat_id FROM categories LIMIT 1;
  IF v_cat_id IS NULL THEN
    RAISE EXCEPTION 'No category available for tests';
  END IF;

  -- Create a fresh standalone product to convert into a parent.
  INSERT INTO products (
    id, name, sku, category_id, unit,
    retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, created_at, updated_at
  )
  VALUES (
    v_prod_id, 'PGTAP_S27C_PROD', 'PGTAPS27C', v_cat_id, 'pcs',
    1000, 500,
    true, true, true, true,
    true, now(), now()
  );

  PERFORM set_config('breakery.s27c_admin_uid',   v_admin_uid::TEXT,   false);
  PERFORM set_config('breakery.s27c_cashier_uid', v_cashier_uid::TEXT, false);
  PERFORM set_config('breakery.s27c_cat_id',      v_cat_id::TEXT,      false);
  PERFORM set_config('breakery.s27c_prod_id',     v_prod_id::TEXT,     false);

  -- Pin admin claim for all subsequent RPC calls (T1/T2/T4..).
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_admin_uid::TEXT, 'role', 'authenticated')::TEXT,
    false);
END $fixtures$;

-- ────────────────────────────────────────────────────────────────────────────
-- T1 : convert_product_to_parent_v1 happy path as SUPER_ADMIN.
-- ────────────────────────────────────────────────────────────────────────────

DO $t1$
DECLARE
  v_parent_id UUID;
BEGIN
  v_parent_id := convert_product_to_parent_v1(
    current_setting('breakery.s27c_prod_id')::UUID,
    'Nature',
    'flavor'::variant_axis_type
  );
  PERFORM set_config('breakery.s27c_parent_id', v_parent_id::TEXT, false);
END $t1$;

SELECT ok(
  current_setting('breakery.s27c_parent_id')::UUID IS NOT NULL,
  'T1  convert_product_to_parent_v1 returns a UUID (parent id)'
);

-- T1b : audit_logs.parent_created row exists
SELECT ok(
  EXISTS (
    SELECT 1 FROM audit_logs
     WHERE action = 'products.variant.parent_created'
       AND entity_id = current_setting('breakery.s27c_parent_id')::UUID
       AND actor_id  = current_setting('breakery.s27c_admin_uid')::UUID
  ),
  'T1b audit_logs.products.variant.parent_created row exists'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T2 : convert refuses if product is already a variant.
--      After T1, s27c_prod_id IS a variant (parent_product_id NOT NULL).
-- ────────────────────────────────────────────────────────────────────────────

SELECT throws_ok(
  format(
    $q$SELECT convert_product_to_parent_v1(%L::UUID, 'NatureAgain', 'flavor'::variant_axis_type)$q$,
    current_setting('breakery.s27c_prod_id')
  ),
  'P0004',
  NULL,
  'T2  convert_product_to_parent_v1 rejects already-variant product (P0004)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T3 : CASHIER forbidden — set jwt.claim to CASHIER, expect P0003.
-- ────────────────────────────────────────────────────────────────────────────

DO $t3_setup$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('breakery.s27c_cashier_uid'),
      'role', 'authenticated'
    )::TEXT, false);
END $t3_setup$;

SELECT throws_ok(
  format(
    $q$SELECT convert_product_to_parent_v1(%L::UUID, 'Lait', 'flavor'::variant_axis_type)$q$,
    gen_random_uuid()
  ),
  'P0003',
  NULL,
  'T3  CASHIER cannot call convert_product_to_parent_v1 (P0003 forbidden)'
);

-- Reset to admin for subsequent tests.
DO $t3_reset$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('breakery.s27c_admin_uid'),
      'role', 'authenticated'
    )::TEXT, false);
END $t3_reset$;

-- ────────────────────────────────────────────────────────────────────────────
-- T4 : create_variant_v1 happy path. Verify unit inherits from parent.
-- ────────────────────────────────────────────────────────────────────────────

DO $t4$
DECLARE
  v_new_var UUID;
BEGIN
  v_new_var := create_variant_v1(
    current_setting('breakery.s27c_parent_id')::UUID,
    'Amande',
    'PGTAPAMD',
    1200
  );
  PERFORM set_config('breakery.s27c_var2_id', v_new_var::TEXT, false);
END $t4$;

SELECT ok(
  (SELECT unit FROM products WHERE id = current_setting('breakery.s27c_var2_id')::UUID) = 'pcs'
  AND current_setting('breakery.s27c_var2_id')::UUID IS NOT NULL,
  'T4  create_variant_v1 returns UUID + unit inherited from parent'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T5 : SKU duplicate raises 23505.
-- ────────────────────────────────────────────────────────────────────────────

SELECT throws_ok(
  format(
    $q$SELECT create_variant_v1(%L::UUID, 'Choco', 'PGTAPAMD', 1300)$q$,
    current_setting('breakery.s27c_parent_id')
  ),
  '23505',
  NULL,
  'T5  create_variant_v1 rejects duplicate SKU (23505 unique_violation)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T6 : update_variant_v1 patch.
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  (SELECT update_variant_v1(
    current_setting('breakery.s27c_var2_id')::UUID,
    '{"retail_price": 1500, "variant_label": "Amande Premium"}'::JSONB
  )) IS NOT NULL,
  'T6  update_variant_v1 returns the variant id (patch applied)'
);

SELECT is(
  (SELECT retail_price FROM products WHERE id = current_setting('breakery.s27c_var2_id')::UUID),
  1500::NUMERIC,
  'T6b retail_price updated to 1500'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T7 : delete_variant_v1 soft delete (is_active=false).
-- ────────────────────────────────────────────────────────────────────────────

SELECT ok(
  (SELECT delete_variant_v1(current_setting('breakery.s27c_var2_id')::UUID)) IS NOT NULL,
  'T7  delete_variant_v1 returns the variant id'
);

SELECT is(
  (SELECT is_active FROM products WHERE id = current_setting('breakery.s27c_var2_id')::UUID),
  false,
  'T7b is_active flipped to false'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T8 : delete refuses last remaining active variant.
--      After T7, only s27c_prod_id is active under the parent.
-- ────────────────────────────────────────────────────────────────────────────

SELECT throws_ok(
  format(
    $q$SELECT delete_variant_v1(%L::UUID)$q$,
    current_setting('breakery.s27c_prod_id')
  ),
  'P0004',
  NULL,
  'T8  delete_variant_v1 refuses last remaining active variant (P0004)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T9 : reorder_variants_v1 happy with 2 variants. Add a 2nd active first.
-- ────────────────────────────────────────────────────────────────────────────

DO $t9_setup$
DECLARE
  v_var3 UUID;
BEGIN
  v_var3 := create_variant_v1(
    current_setting('breakery.s27c_parent_id')::UUID,
    'Choco',
    'PGTAPCHO',
    1400
  );
  PERFORM set_config('breakery.s27c_var3_id', v_var3::TEXT, false);
END $t9_setup$;

SELECT is(
  (SELECT reorder_variants_v1(
    current_setting('breakery.s27c_parent_id')::UUID,
    ARRAY[
      current_setting('breakery.s27c_var3_id')::UUID,
      current_setting('breakery.s27c_prod_id')::UUID
    ]
  )),
  2,
  'T9  reorder_variants_v1 assigns 2 sort orders'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T10 : reorder incomplete coverage (1 of 2 active) raises P0004.
-- ────────────────────────────────────────────────────────────────────────────

SELECT throws_ok(
  format(
    $q$SELECT reorder_variants_v1(%L::UUID, ARRAY[%L::UUID]::UUID[])$q$,
    current_setting('breakery.s27c_parent_id'),
    current_setting('breakery.s27c_prod_id')
  ),
  'P0004',
  NULL,
  'T10 reorder_variants_v1 rejects incomplete coverage (P0004)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T11 : dissolve refuses parent with >1 active variants.
--       After T9 we have 2 active : s27c_prod_id + s27c_var3_id.
-- ────────────────────────────────────────────────────────────────────────────

SELECT throws_ok(
  format(
    $q$SELECT convert_parent_to_standalone_v1(%L::UUID)$q$,
    current_setting('breakery.s27c_parent_id')
  ),
  'P0004',
  NULL,
  'T11 convert_parent_to_standalone_v1 refuses with >1 active variant (P0004)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T12 : dissolve happy with exactly 1 active. Use a FRESH parent (just-converted)
--       to avoid hitting the soft-deleted-sibling bug uncovered in DEV-S27C-4.A-01
--       (see report — the active_count=1 branch of convert_parent_to_standalone_v1
--       NULLs only parent_product_id on soft-deleted siblings, leaving
--       variant_label/axis partial-NULL and violating the XOR check).
--       A fresh parent has 0 soft-deleted siblings, so the bug does not fire.
-- ────────────────────────────────────────────────────────────────────────────

DO $t12_setup$
DECLARE
  v_cat_id  UUID := current_setting('breakery.s27c_cat_id')::UUID;
  v_solo_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO products (
    id, name, sku, category_id, unit, retail_price, cost_price,
    visible_on_pos, available_for_sale, track_inventory, deduct_stock,
    is_active, created_at, updated_at
  )
  VALUES (
    v_solo_id, 'PGTAP_S27C_SOLO', 'PGTAPSOLO', v_cat_id, 'pcs',
    900, 400, true, true, true, true, true, now(), now()
  );
  PERFORM set_config('breakery.s27c_solo_id', v_solo_id::TEXT, false);
  -- Convert to parent — solo_id becomes the only active variant.
  PERFORM set_config(
    'breakery.s27c_solo_parent_id',
    convert_product_to_parent_v1(v_solo_id, 'Default', 'size'::variant_axis_type)::TEXT,
    false
  );
END $t12_setup$;

SELECT ok(
  (SELECT convert_parent_to_standalone_v1(
    current_setting('breakery.s27c_solo_parent_id')::UUID
  )) IS NOT NULL,
  'T12 convert_parent_to_standalone_v1 happy with 1 active variant'
);

SELECT is(
  (SELECT parent_product_id FROM products WHERE id = current_setting('breakery.s27c_solo_id')::UUID),
  NULL,
  'T12b dissolved variant flipped to standalone (parent_product_id NULL)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T13 : Anti-nesting trigger rejects setting a variant-of-a-variant.
--       Create 2 fresh standalone products, make P1 a parent, then try to
--       set P2 as variant of P2 (so P2 must itself be a variant of P1 first).
--       Actually : the trigger refuses (1) "parent is itself a variant" AND
--       (2) "the product becoming a variant has existing children".
--       We test branch (1) : create P1 standalone, convert to parent
--       (so the original P1 UUID is now a variant), then try to set P2 as a
--       variant of that variant-UUID. Trigger should fire.
-- ────────────────────────────────────────────────────────────────────────────

DO $t13_setup$
DECLARE
  v_cat_id UUID := current_setting('breakery.s27c_cat_id')::UUID;
  v_p1     UUID := gen_random_uuid();
  v_p2     UUID := gen_random_uuid();
BEGIN
  INSERT INTO products (id, name, sku, category_id, unit, retail_price, cost_price, is_active, created_at, updated_at)
  VALUES (v_p1, 'PGTAP_NEST_A', 'PGTAPNESTA', v_cat_id, 'pcs', 1, 1, true, now(), now()),
         (v_p2, 'PGTAP_NEST_B', 'PGTAPNESTB', v_cat_id, 'pcs', 1, 1, true, now(), now());

  PERFORM set_config('breakery.s27c_nest_a', v_p1::TEXT, false);
  PERFORM set_config('breakery.s27c_nest_b', v_p2::TEXT, false);

  -- Make P1 a parent — P1's UUID is now a variant of a fresh parent.
  PERFORM convert_product_to_parent_v1(v_p1, 'Nest1', 'flavor'::variant_axis_type);
END $t13_setup$;

SELECT throws_ok(
  format(
    $q$UPDATE products
         SET parent_product_id = %L::UUID,
             variant_label = 'WouldBeNested',
             variant_axis  = 'flavor'::variant_axis_type
       WHERE id = %L::UUID$q$,
    current_setting('breakery.s27c_nest_a'),
    current_setting('breakery.s27c_nest_b')
  ),
  'P0004',
  NULL,
  'T13 trigger rejects nesting (parent is itself a variant) (P0004)'
);

-- ────────────────────────────────────────────────────────────────────────────
-- T14 : CHECK products_variant_xor rejects partial NULL on INSERT.
--       parent_product_id IS NOT NULL but variant_label/axis IS NULL → 23514.
--
--       Note : BEFORE INSERT triggers fire before CHECK constraints. So if
--       we used a variant UUID (like s27c_nest_a) as parent_product_id, the
--       anti-nesting trigger would fire FIRST with P0004 — masking the
--       CHECK we want to assert. We use a fresh standalone product as the
--       referenced parent so the trigger does NOT fire, leaving the CHECK
--       to be the first thing to reject the row.
-- ────────────────────────────────────────────────────────────────────────────

DO $t14_setup$
DECLARE
  v_cat_id  UUID := current_setting('breakery.s27c_cat_id')::UUID;
  v_ref_id  UUID := gen_random_uuid();
BEGIN
  INSERT INTO products (id, name, sku, category_id, unit, retail_price, cost_price, is_active, created_at, updated_at)
  VALUES (v_ref_id, 'PGTAP_S27C_T14_REF', 'PGTAPT14REF', v_cat_id, 'pcs', 1, 1, true, now(), now());
  PERFORM set_config('breakery.s27c_t14_ref', v_ref_id::TEXT, false);
END $t14_setup$;

SELECT throws_ok(
  format(
    $q$INSERT INTO products (id, name, sku, category_id, unit, retail_price, cost_price, is_active, created_at, updated_at, parent_product_id)
         VALUES (gen_random_uuid(), 'BAD', 'PGTAPBAD', %L::UUID, 'pcs', 1, 1, true, now(), now(), %L::UUID)$q$,
    current_setting('breakery.s27c_cat_id'),
    current_setting('breakery.s27c_t14_ref')
  ),
  '23514',
  NULL,
  'T14 CHECK products_variant_xor rejects partial NULL (23514)'
);

SELECT * FROM finish();
ROLLBACK;
