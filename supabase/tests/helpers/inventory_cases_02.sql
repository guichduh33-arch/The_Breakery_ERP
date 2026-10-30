-- =========================================================================
-- T14 — Regression: legacy stock_movements writes (sale/sale_void) still work.
-- =========================================================================
DO $t14$
DECLARE
  v_admin_profile UUID;
  v_admin_uid UUID := current_setting('breakery.admin_uid')::uuid;
  v_sale_id UUID;
  v_void_id UUID;
  v_ok_sale BOOLEAN;
  v_ok_void BOOLEAN;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin_uid);
  SELECT id INTO v_admin_profile FROM user_profiles WHERE auth_user_id = v_admin_uid;

  UPDATE products SET current_stock = 30
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  -- unit is mandatory on stock_movements (UNIT-FIX). For these legacy
  -- writes that bypass the RPC layer, copy the product's unit explicitly.
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    'sale', -2.000,
    (SELECT unit FROM products WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid),
    'orders', gen_random_uuid(), v_admin_profile
  ) RETURNING id INTO v_sale_id;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    'sale_void', 2.000,
    (SELECT unit FROM products WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid),
    'orders', gen_random_uuid(), v_admin_profile
  ) RETURNING id INTO v_void_id;

  SELECT (movement_type = 'sale' AND quantity = -2.000) INTO v_ok_sale
    FROM stock_movements WHERE id = v_sale_id;
  SELECT (movement_type = 'sale_void' AND quantity = 2.000) INTO v_ok_void
    FROM stock_movements WHERE id = v_void_id;

  PERFORM set_config('breakery.t14_pass', (v_ok_sale AND v_ok_void)::text, false);
END $t14$;
SELECT ok(current_setting('breakery.t14_pass')::boolean,
  'T14: legacy sale + sale_void writes still pass CHECK constraints (no regression)');

-- =========================================================================
-- T15 — record_stock_movement_v1 EXECUTE is REVOKED from authenticated.
-- =========================================================================
-- An earlier draft of this test wrapped a real `PERFORM record_stock_movement_v1(...)`
-- call in `SET LOCAL ROLE authenticated` + a nested `BEGIN…EXCEPTION` inside a
-- DO block. That pattern passed under `docker exec ... psql` but terminated
-- the Postgres backend under `supabase test db` (pg_prove) in CI — the failure
-- was sensitive to the PG minor version bundled by the supabase CLI used in
-- CI vs. local. `has_function_privilege` consults the same ACL Postgres
-- evaluates at call time, so this catalog check asserts the identical
-- invariant without the subtransaction/role-switch gymnastics.
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT oid FROM pg_proc
       WHERE proname = 'record_stock_movement_v1'
         AND pronamespace = 'public'::regnamespace),
    'EXECUTE'
  ),
  'T15: record_stock_movement_v1 EXECUTE is REVOKED from authenticated role'
);

-- =========================================================================
-- T16 — record_incoming_stock_v2 from CASHIER (no inventory.receive) -> P0003
-- =========================================================================
DO $$
DECLARE v_cashier UUID;
BEGIN
  SELECT auth_user_id INTO v_cashier FROM user_profiles WHERE employee_code = 'EMP001';
  IF v_cashier IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP001 (CASHIER) not found — run pnpm db:reset first';
  END IF;
  PERFORM pg_temp.set_jwt_uid(v_cashier);
END $$;

SELECT throws_ok(
  $$ SELECT record_incoming_stock_v2(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
       1.000,
       NULL, NULL, 'T16 cashier should fail'
     ) $$,
  'P0003',
  'forbidden',
  'T16: CASHIER without inventory.receive receives forbidden (P0003)'
);

-- Restore MANAGER context for T17 (MANAGER has inventory.receive per
-- has_permission v7 / migration 20260516000004).
DO $$
DECLARE v_manager UUID;
BEGIN
  SELECT auth_user_id INTO v_manager FROM user_profiles WHERE employee_code = 'EMP003';
  IF v_manager IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP003 (MANAGER) not found — run pnpm db:reset first';
  END IF;
  PERFORM pg_temp.set_jwt_uid(v_manager);
END $$;

-- =========================================================================
-- T17 — record_incoming_stock_v2 with quantity = 0 -> quantity_must_be_positive
-- =========================================================================
SELECT throws_ok(
  $$ SELECT record_incoming_stock_v2(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
       0,
       NULL, NULL, 'T17 zero qty'
     ) $$,
  NULL,
  'quantity_must_be_positive',
  'T17: MANAGER + qty=0 rejected with quantity_must_be_positive'
);

-- =========================================================================
-- T18 — record_incoming_stock_v2 MANAGER happy path (no supplier, qty 5):
--       stock_movements row with movement_type='incoming' and supplier_id IS NULL,
--       products.current_stock increased by 5, one new audit_logs row.
-- =========================================================================
DO $t18$
DECLARE
  v_manager UUID;
  v_result JSONB;
  v_mvt_id UUID;
  v_mvt RECORD;
  v_audit_count INT;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  SELECT auth_user_id INTO v_manager FROM user_profiles WHERE employee_code = 'EMP003';
  PERFORM pg_temp.set_jwt_uid(v_manager);
  UPDATE products SET current_stock = 10
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
  SELECT current_stock INTO v_before FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT record_incoming_stock_v2(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    5.000,
    NULL, NULL, 'T18 free-form receipt'
  ) INTO v_result;
  v_mvt_id := (v_result->>'movement_id')::uuid;

  SELECT movement_type, quantity, supplier_id
    INTO v_mvt FROM stock_movements WHERE id = v_mvt_id;
  SELECT COUNT(*) INTO v_audit_count
    FROM audit_logs
   WHERE entity_type = 'stock_movements' AND entity_id = v_mvt_id;
  SELECT current_stock INTO v_after FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  PERFORM set_config('breakery.t18_pass',
    CASE WHEN
      v_mvt.movement_type = 'incoming'::movement_type
      AND v_mvt.supplier_id IS NULL
      AND v_mvt.quantity = 5.000
      AND v_after = v_before + 5.000
      AND v_audit_count = 1
    THEN 'true' ELSE 'false' END, false);
END $t18$;
SELECT ok(current_setting('breakery.t18_pass')::boolean,
  'T18: MANAGER + no supplier + qty 5.000 yields incoming movement, +5 stock, 1 audit row');

-- =========================================================================
-- T19 — record_incoming_stock_v2 with soft-deleted supplier -> P0002
-- =========================================================================
SELECT throws_ok(
  $$ SELECT record_incoming_stock_v2(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
       3.000,
       '11111111-2222-3333-4444-777777777777'::uuid,
       NULL, 'T19 soft-deleted supplier'
     ) $$,
  'P0002',
  'supplier_not_found_or_inactive',
  'T19: MANAGER + soft-deleted supplier rejected with supplier_not_found_or_inactive (P0002)'
);

-- =========================================================================
-- T20 — record_incoming_stock_v2 idempotent replay (same idempotency_key):
--       second call returns idempotent_replay=true, only ONE stock_movements
--       row exists for that key, current_stock only bumped once.
-- =========================================================================
DO $t20$
DECLARE
  v_manager UUID;
  v_key UUID := '00000000-0000-0000-0000-000000000def'::uuid;
  v_r1 JSONB;
  v_r2 JSONB;
  v_row_count INT;
  v_before NUMERIC;
  v_after_first NUMERIC;
  v_after_second NUMERIC;
BEGIN
  SELECT auth_user_id INTO v_manager FROM user_profiles WHERE employee_code = 'EMP003';
  PERFORM pg_temp.set_jwt_uid(v_manager);
  UPDATE products SET current_stock = 10
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
  -- Clean any prior T20 idempotency row so we measure this run only.
  DELETE FROM stock_movements WHERE idempotency_key = v_key;
  SELECT current_stock INTO v_before FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT record_incoming_stock_v2(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    7.000,
    NULL, NULL, 'T20 first', v_key
  ) INTO v_r1;
  SELECT current_stock INTO v_after_first FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT record_incoming_stock_v2(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    7.000,
    NULL, NULL, 'T20 first', v_key
  ) INTO v_r2;
  SELECT current_stock INTO v_after_second FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT COUNT(*) INTO v_row_count
    FROM stock_movements
   WHERE idempotency_key = v_key
     AND product_id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  PERFORM set_config('breakery.t20_pass',
    CASE WHEN
      (v_r1->>'movement_id') = (v_r2->>'movement_id')
      AND (v_r2->>'idempotent_replay')::boolean = true
      AND v_row_count = 1
      AND v_after_first = v_before + 7.000
      AND v_after_second = v_after_first
    THEN 'true' ELSE 'false' END, false);
END $t20$;
SELECT ok(current_setting('breakery.t20_pass')::boolean,
  'T20: record_incoming_stock_v2 idempotency replay yields one row + idempotent_replay=true + stock bumped once');

-- =========================================================================
-- T21 — ADR-024 déc. 1 : le total ne voyage plus sur les lignes. Il vient de
-- get_stock_counters_v1, et il est INDÉPENDANT de la fenêtre de pagination —
-- c'est précisément ce qui lui permet d'exister quand la page est vide.
-- =========================================================================
DO $t21$
DECLARE
  v_admin        UUID := current_setting('breakery.admin_uid')::uuid;
  v_total_seen   BIGINT;
  v_expected     BIGINT;
  v_window_rows  BIGINT;
  v_empty_total  BIGINT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  SELECT COUNT(*) INTO v_expected FROM products WHERE deleted_at IS NULL;

  SELECT total_count INTO v_total_seen FROM get_stock_counters_v1(NULL, NULL);
  SELECT COUNT(*) INTO v_window_rows
    FROM get_stock_levels_v4(NULL, NULL, 'all', 5, 0);

  -- Le cœur de la décision : une recherche qui ne ramène AUCUNE ligne laisse
  -- quand même un total lisible. Avec l'ancien contrat, il valait 0.
  SELECT total_count INTO v_empty_total
    FROM get_stock_counters_v1(NULL, 'PGTAP-AUCUN-PRODUIT-NE-MATCHE-CECI');

  PERFORM set_config('breakery.t21_pass',
    CASE WHEN
      v_total_seen = v_expected
      AND v_expected >= 5          -- guard: we requested a window of 5
      AND v_window_rows = 5        -- la fenêtre est bien bornée
      AND v_total_seen <> v_window_rows  -- le total n'est pas le compte de page
      AND v_empty_total = 0        -- aucun produit ne matche : 0, mais LISIBLE
    THEN 'true' ELSE 'false' END, false);
END $t21$;
SELECT ok(current_setting('breakery.t21_pass')::boolean,
  'T21: get_stock_counters_v1 renders a total independent of the page window, and still answers on an empty result set');

-- =========================================================================
-- T22 — get_stock_levels_v4 search is case-insensitive (ILIKE in the RPC).
-- =========================================================================
DO $t22$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_has_upper BOOLEAN;
  v_has_lower BOOLEAN;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  SELECT EXISTS (
    SELECT 1 FROM get_stock_levels_v4(NULL, 'PGTAP-PROD-1', 'all', 100, 0)
     WHERE sku = 'PGTAP-PROD-1'
  ) INTO v_has_upper;

  SELECT EXISTS (
    SELECT 1 FROM get_stock_levels_v4(NULL, 'pgtap-prod-1', 'all', 100, 0)
     WHERE sku = 'PGTAP-PROD-1'
  ) INTO v_has_lower;

  PERFORM set_config('breakery.t22_pass',
    (v_has_upper AND v_has_lower)::text, false);
END $t22$;
SELECT ok(current_setting('breakery.t22_pass')::boolean,
  'T22: get_stock_levels_v4 p_search is case-insensitive (ILIKE) — upper/lower both match');

-- =========================================================================
-- T23 — get_stock_levels_v4 p_category_id filter returns only matching rows.
-- We retarget the three PGTAP fixture products onto category "Sandwiches"
-- (UUID 44444444-...) so the filter narrows to a known disjoint set.
-- =========================================================================
DO $t23$
DECLARE
  v_admin    UUID := current_setting('breakery.admin_uid')::uuid;
  v_cat      UUID := '44444444-4444-4444-4444-444444444444'::uuid;
  v_other_cnt INT;
  v_match_cnt INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  -- Retarget the three PGTAP fixtures onto v_cat.
  UPDATE products SET category_id = v_cat
    WHERE id IN (
      '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
      '99999999-aaaa-bbbb-cccc-222222222222'::uuid,
      '99999999-aaaa-bbbb-cccc-333333333333'::uuid
    );

  -- Every row returned must have category_id = v_cat (no leakage).
  SELECT COUNT(*) INTO v_other_cnt
    FROM get_stock_levels_v4(v_cat, NULL, 'all', 100, 0)
   WHERE category_id <> v_cat OR category_id IS NULL;

  -- The three fixtures must be present in the filtered result.
  SELECT COUNT(*) INTO v_match_cnt
    FROM get_stock_levels_v4(v_cat, 'PGTAP-PROD', 'all', 100, 0)
   WHERE sku LIKE 'PGTAP-PROD%';

  PERFORM set_config('breakery.t23_pass',
    CASE WHEN v_other_cnt = 0 AND v_match_cnt = 3
    THEN 'true' ELSE 'false' END, false);
END $t23$;
SELECT ok(current_setting('breakery.t23_pass')::boolean,
  'T23: get_stock_levels_v4 p_category_id filter returns only matching products (no leakage)');

-- =========================================================================
-- T24 — get_stock_levels_v4 bucket 'low' excludes rows where
-- current_stock >= threshold (here threshold>0 but stock above threshold).
-- We bump PGTAP-PROD-2 to 100 (threshold=20) → must NOT appear.
-- =========================================================================
DO $t24$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_prod2_in_low BOOLEAN;
  v_prod_low_in_low BOOLEAN;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 100 WHERE id = '99999999-aaaa-bbbb-cccc-222222222222'::uuid;
  UPDATE products SET current_stock = 5   WHERE id = '99999999-aaaa-bbbb-cccc-333333333333'::uuid;

  SELECT EXISTS (
    SELECT 1 FROM get_stock_levels_v4(NULL, 'PGTAP-PROD-2', 'low', 100, 0)
     WHERE sku = 'PGTAP-PROD-2'
  ) INTO v_prod2_in_low;

  SELECT EXISTS (
    SELECT 1 FROM get_stock_levels_v4(NULL, 'PGTAP-PROD-LOW', 'low', 100, 0)
     WHERE sku = 'PGTAP-PROD-LOW'
  ) INTO v_prod_low_in_low;

  -- PGTAP-PROD-2 (100 stock >= 20 threshold) must NOT appear.
  -- PGTAP-PROD-LOW (5 stock < 10 threshold) MUST appear.
  PERFORM set_config('breakery.t24_pass',
    (NOT v_prod2_in_low AND v_prod_low_in_low)::text, false);
END $t24$;
SELECT ok(current_setting('breakery.t24_pass')::boolean,
  'T24: get_stock_levels_v4 bucket low excludes rows where current_stock >= threshold (threshold>0)');
