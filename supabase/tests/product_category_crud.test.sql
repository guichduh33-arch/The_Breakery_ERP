-- supabase/tests/product_category_crud.test.sql
-- Session 27b — pgTAP suite for create_product_v1 + categories CRUD.
--
-- Coverage (10 asserts) :
--   T1   MANAGER create_product_v1 happy path : products row created
--   T1b  product_unit_contexts seeded with base unit on create
--   T2   CASHIER cannot create_product_v1 (42501)
--   T3   missing sku raises 22023 missing_required_fields
--   T4   duplicate sku raises 23505 sku_taken
--   T5   create_category_v1 auto-slugify produces lowercase hyphenated slug
--   T6   empty name raises 22023
--   T7   reorder_categories_v1 assigns 10, 20, ... in the given order
--   T8   reorder with unknown id raises 22023 incomplete_ordered_ids
--   T9   reorder with duplicate ids raises 22023 duplicate_ids
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE TEMP TABLE pgtap_results (n SERIAL, line TEXT);

SELECT plan(10);

DO $$
DECLARE
  v_admin_uid UUID;
  v_cashier_uid UUID;
  v_cat_id UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
    WHERE employee_code = 'EMP000' LIMIT 1;
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles
    WHERE role_code = 'CASHIER' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_cat_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  PERFORM set_config('breakery.s27b_admin_uid', v_admin_uid::TEXT, false);
  PERFORM set_config('breakery.s27b_cashier_uid', v_cashier_uid::TEXT, false);
  PERFORM set_config('breakery.s27b_cat_id', v_cat_id::TEXT, false);
END $$;

-- T1 + T1b
DO $t1$
DECLARE
  v_result JSONB;
  v_new_sku TEXT := 'S27B-T1-' || gen_random_uuid()::TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.s27b_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
  v_result := create_product_v1(jsonb_build_object(
    'name', 'S27B pgTAP T1 Product',
    'sku', v_new_sku,
    'category_id', current_setting('breakery.s27b_cat_id'),
    'retail_price', 12345,
    'unit', 'pcs'
  ));
  PERFORM set_config('breakery.s27b_t1_sku', v_new_sku, false);
  PERFORM set_config('breakery.s27b_t1_id', v_result->'product'->>'id', false);
END $t1$;

INSERT INTO pgtap_results(line)
  SELECT is(
    (SELECT sku FROM products WHERE id = current_setting('breakery.s27b_t1_id')::UUID),
    current_setting('breakery.s27b_t1_sku'),
    'T1 MANAGER create_product_v1 happy path : products row created with matching sku'
  );

INSERT INTO pgtap_results(line)
  SELECT ok(
    EXISTS (
      SELECT 1 FROM product_unit_contexts
       WHERE product_id = current_setting('breakery.s27b_t1_id')::UUID
         AND sales_unit = 'pcs'
    ),
    'T1b product_unit_contexts seeded with base unit on create'
  );

-- T2
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.s27b_cashier_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

INSERT INTO pgtap_results(line)
  SELECT throws_ok(
    format(
      $q$SELECT create_product_v1(jsonb_build_object(
        'name','x','sku','S27B-T2-FAIL','category_id',%L::TEXT
      ))$q$,
      current_setting('breakery.s27b_cat_id')
    ),
    '42501',
    'permission_denied',
    'T2 CASHIER cannot create_product_v1 (42501)'
  );

-- T3 + T4 (admin impersonation again)
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.s27b_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

INSERT INTO pgtap_results(line)
  SELECT throws_ok(
    format(
      $q$SELECT create_product_v1(jsonb_build_object(
        'name','no-sku','category_id',%L::TEXT
      ))$q$,
      current_setting('breakery.s27b_cat_id')
    ),
    '22023',
    'missing_required_fields',
    'T3 missing sku raises 22023 missing_required_fields'
  );

INSERT INTO pgtap_results(line)
  SELECT throws_ok(
    format(
      $q$SELECT create_product_v1(jsonb_build_object(
        'name','dup','sku',%L,'category_id',%L::TEXT
      ))$q$,
      current_setting('breakery.s27b_t1_sku'),
      current_setting('breakery.s27b_cat_id')
    ),
    '23505',
    'sku_taken',
    'T4 duplicate sku raises 23505 sku_taken'
  );

-- T5 + T6 : create_category_v1
DO $t5$
DECLARE
  v_result JSONB;
  v_name TEXT := 'S27B Cat ' || substr(gen_random_uuid()::TEXT, 1, 6);
BEGIN
  v_result := create_category_v1(jsonb_build_object('name', v_name));
  PERFORM set_config('breakery.s27b_t5_slug', v_result->>'slug', false);
END $t5$;

INSERT INTO pgtap_results(line)
  SELECT ok(
    current_setting('breakery.s27b_t5_slug') LIKE 's27b-cat-%',
    'T5 create_category_v1 auto-slugify produces lowercase hyphenated slug'
  );

INSERT INTO pgtap_results(line)
  SELECT throws_ok(
    $q$SELECT create_category_v1(jsonb_build_object('name', ''))$q$,
    '22023',
    'missing_required_fields',
    'T6 empty name raises 22023'
  );

-- T7 + T8 + T9 : reorder_categories_v1
DO $t7$
DECLARE
  v_reversed UUID[];
  v_first UUID;
  v_first_sort INTEGER;
  v_last UUID;
  v_last_sort INTEGER;
BEGIN
  SELECT array_agg(id ORDER BY sort_order DESC) INTO v_reversed
    FROM categories WHERE deleted_at IS NULL;
  PERFORM reorder_categories_v1(v_reversed);
  v_first := v_reversed[1];
  v_last  := v_reversed[array_length(v_reversed, 1)];
  SELECT sort_order INTO v_first_sort FROM categories WHERE id = v_first;
  SELECT sort_order INTO v_last_sort  FROM categories WHERE id = v_last;
  PERFORM set_config('breakery.s27b_t7_first_sort', v_first_sort::TEXT, false);
  PERFORM set_config('breakery.s27b_t7_last_sort',  v_last_sort::TEXT, false);
END $t7$;

INSERT INTO pgtap_results(line)
  SELECT ok(
    current_setting('breakery.s27b_t7_first_sort')::INTEGER
      < current_setting('breakery.s27b_t7_last_sort')::INTEGER
    AND current_setting('breakery.s27b_t7_first_sort')::INTEGER = 10,
    'T7 reorder_categories_v1 assigns 10, 20, ... in the given order'
  );

INSERT INTO pgtap_results(line)
  SELECT throws_ok(
    $q$SELECT reorder_categories_v1(ARRAY[gen_random_uuid()])$q$,
    '22023',
    'incomplete_ordered_ids',
    'T8 reorder with unknown id raises 22023 incomplete_ordered_ids'
  );

DO $t9$
DECLARE
  v_one UUID;
BEGIN
  SELECT id INTO v_one FROM categories WHERE deleted_at IS NULL LIMIT 1;
  PERFORM set_config('breakery.s27b_t9_id', v_one::TEXT, false);
END $t9$;

INSERT INTO pgtap_results(line)
  SELECT throws_ok(
    format(
      $q$SELECT reorder_categories_v1(ARRAY[%L::UUID, %L::UUID])$q$,
      current_setting('breakery.s27b_t9_id'),
      current_setting('breakery.s27b_t9_id')
    ),
    '22023',
    'duplicate_ids',
    'T9 reorder with duplicate ids raises 22023 duplicate_ids'
  );

SELECT n, line FROM pgtap_results ORDER BY n;
ROLLBACK;
