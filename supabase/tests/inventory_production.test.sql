-- supabase/tests/inventory_production.test.sql
-- Session 13 / Phase 2.A — Production + Recipes pgTAP suite.
--
-- Covers the 7 migrations 20260517000060-066 :
--   - recipes table + RLS
--   - production_records table + RLS
--   - upsert_recipe_v1 / list_recipes_v1 / deactivate_recipe_v1
--   - record_production_v1 (atomic, idempotent, lot-aware)
--   - revert_production_v1 (ADMIN+, 24h window, counter-JE)
--   - get_production_suggestions_v1
--   - view_product_recipes
--
-- Critical invariants :
--   - stock_movements remains append-only (revert via INSERT counter-rows).
--   - tr_20_je_emit skips reverse_of_production rows ; counter-JE inserted
--     by revert_production_v1.
--   - FIFO lot resolution UPFRONT in record_stock_movement_v1 (Phase 1.A).
--
-- Runner :
--   Apply this body inside a MCP `execute_sql` BEGIN ... ROLLBACK envelope.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Plan : 15 tests (T_PROD_01..15).
SELECT plan(15);

-- ---------------------------------------------------------------------------
-- Fixtures : a "finished" product T_PROD_BAGUETTE with 4 ingredient recipes
-- (T_PROD_FLOUR, T_PROD_SALT, T_PROD_YEAST, T_PROD_WATER). Three actor
-- profiles (cashier, manager, admin) drawn from seed.sql via employee_code.
-- We use deterministic SKUs prefixed `T_PROD_` to avoid clashing with seed.
--
-- NB: V3 `products.product_type` CHECK restricts values to {finished, combo}.
-- The legacy V2 `raw_material` / `semi_finished` types are NOT enumerated —
-- in V3 the material/ingredient distinction is conveyed by category (not by
-- product_type). All test products use product_type='finished'.
-- See docs/workplan/refs/2026-05-13-session-13-wave-2-deviations.md.
-- ---------------------------------------------------------------------------
DO $fix$
DECLARE
  v_cat            UUID;
  v_baguette_id    UUID;
  v_flour_id       UUID;
  v_salt_id        UUID;
  v_yeast_id       UUID;
  v_water_id       UUID;
  v_manager_profile UUID;
  v_admin_profile   UUID;
  v_cashier_profile UUID;
  v_section_id      UUID;
BEGIN
  SELECT id INTO v_cat FROM categories LIMIT 1;

  -- Finished product (no shelf life — keep first test simple ; F1 lot tested elsewhere).
  INSERT INTO products (sku, name, category_id, retail_price, wholesale_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES ('T_PROD_BAGUETTE', 'Test Baguette', v_cat, 5000, 3000, 0, 'pcs', 1500, 'finished', true)
  ON CONFLICT (sku) DO UPDATE SET current_stock = 0
  RETURNING id INTO v_baguette_id;

  -- "Materials" (V3 keeps everything as product_type='finished').
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price,
                        product_type, is_active)
  VALUES ('T_PROD_FLOUR', 'Test Flour', v_cat, 0, 100, 'kg', 10000, 'finished', true)
  ON CONFLICT (sku) DO UPDATE SET current_stock = 100
  RETURNING id INTO v_flour_id;

  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price,
                        product_type, is_active)
  VALUES ('T_PROD_SALT', 'Test Salt', v_cat, 0, 50, 'kg', 5000, 'finished', true)
  ON CONFLICT (sku) DO UPDATE SET current_stock = 50
  RETURNING id INTO v_salt_id;

  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price,
                        product_type, is_active)
  VALUES ('T_PROD_YEAST', 'Test Yeast', v_cat, 0, 10, 'kg', 80000, 'finished', true)
  ON CONFLICT (sku) DO UPDATE SET current_stock = 10
  RETURNING id INTO v_yeast_id;

  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price,
                        product_type, is_active)
  VALUES ('T_PROD_WATER', 'Test Water', v_cat, 0, 200, 'L', 1000, 'finished', true)
  ON CONFLICT (sku) DO UPDATE SET current_stock = 200
  RETURNING id INTO v_water_id;

  -- Section
  SELECT id INTO v_section_id FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;

  -- Resolve actor profiles by employee_code (seeded).
  SELECT id INTO v_manager_profile FROM user_profiles WHERE employee_code='EMP003' AND deleted_at IS NULL;
  SELECT id INTO v_admin_profile   FROM user_profiles WHERE employee_code='EMP000' AND deleted_at IS NULL;
  SELECT id INTO v_cashier_profile FROM user_profiles WHERE employee_code='EMP001' AND deleted_at IS NULL;

  PERFORM set_config('breakery.t_prod_baguette',  v_baguette_id::text,    true);
  PERFORM set_config('breakery.t_prod_flour',     v_flour_id::text,       true);
  PERFORM set_config('breakery.t_prod_salt',      v_salt_id::text,        true);
  PERFORM set_config('breakery.t_prod_yeast',     v_yeast_id::text,       true);
  PERFORM set_config('breakery.t_prod_water',     v_water_id::text,       true);
  PERFORM set_config('breakery.t_prod_section',   v_section_id::text,     true);
  PERFORM set_config('breakery.t_prod_manager',   v_manager_profile::text, true);
  PERFORM set_config('breakery.t_prod_admin',     v_admin_profile::text,   true);
  PERFORM set_config('breakery.t_prod_cashier',   v_cashier_profile::text, true);
END $fix$;

-- ---------------------------------------------------------------------------
-- T_PROD_01 — recipes table exists with key columns
-- ---------------------------------------------------------------------------
SELECT has_table('recipes', 'T_PROD_01: recipes table exists');

-- ---------------------------------------------------------------------------
-- T_PROD_02 — recipes UNIQUE PARTIAL constraint enforces one active row per (product, material)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bag UUID := current_setting('breakery.t_prod_baguette', true)::uuid;
  v_fl  UUID := current_setting('breakery.t_prod_flour',    true)::uuid;
  v_dup_count INT;
BEGIN
  -- Insert a fresh row (bypass RLS via DEFINER context : we're running as the migration test owner).
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_bag, v_fl, 0.250, 'kg', true);

  -- Second active row with same (product, material) must raise unique_violation.
  BEGIN
    INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
      VALUES (v_bag, v_fl, 0.300, 'kg', true);
    v_dup_count := 1;
  EXCEPTION WHEN unique_violation THEN
    v_dup_count := 0;
  END;

  PERFORM set_config('breakery.t_prod_dup_count', v_dup_count::text, true);
END $$;
SELECT is(current_setting('breakery.t_prod_dup_count')::int, 0,
  'T_PROD_02: UNIQUE PARTIAL blocks duplicate active (product_id, material_id)');

-- Clean up the inserted test row before next tests.
DELETE FROM recipes
  WHERE product_id = current_setting('breakery.t_prod_baguette', true)::uuid
    AND material_id = current_setting('breakery.t_prod_flour',    true)::uuid;

-- ---------------------------------------------------------------------------
-- T_PROD_03 — production_records table exists with constraint on production_number format
-- ---------------------------------------------------------------------------
SELECT has_table('production_records', 'T_PROD_03: production_records table exists');

-- ---------------------------------------------------------------------------
-- T_PROD_04 — RLS lockdown : authenticated cannot INSERT directly into recipes / production_records
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_recipes_insert_count INT;
  v_pr_insert_count      INT;
BEGIN
  -- Check that `authenticated` role lacks INSERT privilege on both tables.
  SELECT COUNT(*) INTO v_recipes_insert_count
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='recipes'
      AND grantee='authenticated' AND privilege_type='INSERT';

  SELECT COUNT(*) INTO v_pr_insert_count
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='production_records'
      AND grantee='authenticated' AND privilege_type='INSERT';

  PERFORM set_config('breakery.t_prod_recipes_insert', v_recipes_insert_count::text, true);
  PERFORM set_config('breakery.t_prod_pr_insert',      v_pr_insert_count::text,      true);
END $$;

SELECT is(
  (current_setting('breakery.t_prod_recipes_insert')::int
    + current_setting('breakery.t_prod_pr_insert')::int),
  0,
  'T_PROD_04: authenticated has no INSERT on recipes or production_records'
);

-- ---------------------------------------------------------------------------
-- T_PROD_05 — MANAGER upserts a recipe (insert then update in place)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_mgr_auth UUID;
  v_rid UUID;
  v_rid2 UUID;
  v_qty NUMERIC;
BEGIN
  SELECT auth_user_id INTO v_mgr_auth FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr_auth IS NULL THEN
    PERFORM set_config('breakery.t_prod_05_pass','skip',true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr_auth::text, true);
  PERFORM set_config('role', 'authenticated', true);
  v_rid  := upsert_recipe_v1(v_bag, v_flo, 0.250, 'kg', 'first');
  v_rid2 := upsert_recipe_v1(v_bag, v_flo, 0.300, 'kg', 'updated');
  SELECT quantity INTO v_qty FROM recipes WHERE id=v_rid;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_05_pass',
    CASE WHEN v_rid = v_rid2 AND v_qty = 0.300 THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_05_pass') IN ('yes','skip'),
  'T_PROD_05: MANAGER upserts (insert then update) recipe row in place');

-- ---------------------------------------------------------------------------
-- T_PROD_06 — CASHIER → forbidden on upsert_recipe_v1
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_cash_auth UUID;
  v_raised BOOLEAN := false;
BEGIN
  SELECT auth_user_id INTO v_cash_auth FROM user_profiles WHERE employee_code='EMP001';
  IF v_cash_auth IS NULL THEN
    PERFORM set_config('breakery.t_prod_06_pass','skip',true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cash_auth::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM upsert_recipe_v1(v_bag, v_flo, 0.250, 'kg', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_raised := (SQLERRM = 'forbidden');
  END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_06_pass', CASE WHEN v_raised THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_06_pass') IN ('yes','skip'),
  'T_PROD_06: CASHIER → forbidden on upsert_recipe_v1');

-- ---------------------------------------------------------------------------
-- T_PROD_07 — ADMIN deactivate flips is_active=false + deleted_at set
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_adm_auth UUID;
  v_rid UUID;
  v_is_active BOOLEAN;
  v_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT auth_user_id INTO v_adm_auth FROM user_profiles WHERE employee_code='EMP000';
  IF v_adm_auth IS NULL THEN
    PERFORM set_config('breakery.t_prod_07_pass','skip',true);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_adm_auth::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT id INTO v_rid FROM recipes
    WHERE product_id=v_bag AND material_id=v_flo AND is_active AND deleted_at IS NULL LIMIT 1;
  IF v_rid IS NULL THEN
    v_rid := upsert_recipe_v1(v_bag, v_flo, 0.250, 'kg', NULL);
  END IF;
  PERFORM deactivate_recipe_v1(v_rid);
  SELECT is_active, deleted_at INTO v_is_active, v_deleted_at FROM recipes WHERE id=v_rid;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_07_pass',
    CASE WHEN v_is_active=false AND v_deleted_at IS NOT NULL THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_07_pass') IN ('yes','skip'),
  'T_PROD_07: ADMIN deactivates recipe → is_active=false + deleted_at set');
-- ---------------------------------------------------------------------------
-- T_PROD_08 — CASHIER → forbidden on record_production_v1
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_cash_auth UUID; v_caught TEXT; v_dummy UUID := gen_random_uuid();
BEGIN
  SELECT auth_user_id INTO v_cash_auth FROM user_profiles WHERE employee_code='EMP001';
  IF v_cash_auth IS NULL THEN
    PERFORM set_config('breakery.t_prod_08_pass','skip',true); RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cash_auth::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM record_production_v1(v_dummy, 10, NULL, NULL, 0, NULL, NULL);
    v_caught := 'no_raise';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_08_pass', CASE WHEN v_caught='forbidden' THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_08_pass') IN ('yes','skip'),
  'T_PROD_08: CASHIER → forbidden on record_production_v1');

-- ---------------------------------------------------------------------------
-- T_PROD_09 — qty <= 0 rejected with quantity_must_be_positive
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_mgr UUID; v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid; v_section UUID := current_setting('breakery.t_prod_section')::uuid; v_caught TEXT;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    PERFORM set_config('breakery.t_prod_09_pass','skip',true); RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  BEGIN
    -- record_production_v1 now requires a non-null section (raised as
    -- section_required BEFORE the qty check), so pass the seeded section to
    -- actually reach and exercise the quantity_must_be_positive guard.
    PERFORM record_production_v1(v_bag, 0, v_section, NULL, 0, NULL, NULL);
    v_caught := 'no_raise';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_09_pass',
    CASE WHEN v_caught='quantity_must_be_positive' THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_09_pass') IN ('yes','skip'),
  'T_PROD_09: qty <= 0 → quantity_must_be_positive');

-- ---------------------------------------------------------------------------
-- T_PROD_10 — insufficient_stock raised with missing items in DETAIL
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr UUID;
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_section UUID := current_setting('breakery.t_prod_section')::uuid;
  v_caught TEXT; v_detail TEXT;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    PERFORM set_config('breakery.t_prod_10_pass','skip',true); RETURN;
  END IF;
  -- Bring flour stock down to 0.5kg so 50 baguettes need 12.5kg → insufficient.
  UPDATE products SET current_stock = 0.5 WHERE id = v_flo;
  -- record_production_v1 is now flag-aware (S53/#122): it only raises
  -- insufficient_stock when business_config.allow_negative_stock is FALSE
  -- (the column defaults to allow, COALESCE(...,true)). Force it off for the
  -- duration of this insufficiency check (rolled back with the suite). Also
  -- pass the seeded section (section is now required before the stock check).
  UPDATE business_config SET allow_negative_stock = false WHERE id = 1;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  -- Ensure single recipe for clarity (deactivate any others on this product first)
  -- Skipped to keep the test isolated.
  PERFORM upsert_recipe_v1(v_bag, v_flo, 250, 'g', NULL);
  BEGIN
    PERFORM record_production_v1(v_bag, 50, v_section, NULL, 0, NULL, NULL);
    v_caught := 'no_raise';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    v_caught := SQLERRM;
  END;
  PERFORM set_config('role','postgres',true);
  UPDATE business_config SET allow_negative_stock = true WHERE id = 1;
  PERFORM set_config('breakery.t_prod_10_pass',
    CASE WHEN v_caught='insufficient_stock' AND v_detail LIKE '%Test Flour%' THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_10_pass') IN ('yes','skip'),
  'T_PROD_10: insufficient_stock raised with missing material in DETAIL');

-- record_production_v1 issues `CREATE TEMP TABLE _bom_flatten / _leaf_consumption
-- ON COMMIT DROP`. Under this suite's single BEGIN..ROLLBACK envelope the temp
-- tables survive across successive invocations and the next call collides with
-- `relation "_bom_flatten" already exists`. Flush them between invocations. In
-- production each RPC call is its own transaction so this never fires.
DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ---------------------------------------------------------------------------
-- T_PROD_11 — happy path : 50 baguettes → 1 in + 4 out + balanced JEs
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr UUID;
  v_bag   UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo   UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_salt  UUID := current_setting('breakery.t_prod_salt')::uuid;
  v_yeast UUID := current_setting('breakery.t_prod_yeast')::uuid;
  v_water UUID := current_setting('breakery.t_prod_water')::uuid;
  v_section UUID;
  v_result JSONB;
  v_pid    UUID;
  v_movements_count INT;
  v_je_balanced INT;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    PERFORM set_config('breakery.t_prod_11_pass','skip',true); RETURN;
  END IF;
  -- Refresh stocks
  UPDATE products SET current_stock=100 WHERE id=v_flo;
  UPDATE products SET current_stock=50  WHERE id=v_salt;
  UPDATE products SET current_stock=10  WHERE id=v_yeast;
  UPDATE products SET current_stock=200 WHERE id=v_water;
  UPDATE products SET current_stock=0   WHERE id=v_bag;
  SELECT id INTO v_section FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  PERFORM upsert_recipe_v1(v_bag, v_flo,   250, 'g',  NULL);
  PERFORM upsert_recipe_v1(v_bag, v_salt,    5, 'g',  NULL);
  PERFORM upsert_recipe_v1(v_bag, v_yeast,   5, 'g',  NULL);
  PERFORM upsert_recipe_v1(v_bag, v_water, 150, 'mL', NULL);

  v_result := record_production_v1(v_bag, 50, v_section, 'BATCH-T11', 0, NULL, NULL);
  v_pid := (v_result->>'production_id')::uuid;
  v_movements_count := (v_result->>'movements_count')::int;

  SELECT COUNT(*) INTO v_je_balanced
    FROM journal_entries je
    JOIN stock_movements sm ON sm.id = je.reference_id
    WHERE sm.metadata->>'production_id' = v_pid::text
      AND je.total_debit = je.total_credit
      AND je.total_debit > 0;

  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_11_pass',
    CASE WHEN v_movements_count=5 AND v_je_balanced=5 THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_11_pass') IN ('yes','skip'),
  'T_PROD_11: 50-baguette happy path → 5 movements + 5 balanced JEs');

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ---------------------------------------------------------------------------
-- T_PROD_12 — idempotency replay returns same production_id, no duplicate movements
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr UUID;
  v_bag   UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo   UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_section UUID;
  v_key UUID := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'::uuid;
  v_r1 JSONB; v_r2 JSONB; v_dup INT;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    PERFORM set_config('breakery.t_prod_12_pass','skip',true); RETURN;
  END IF;
  UPDATE products SET current_stock=100 WHERE id=v_flo;
  UPDATE products SET current_stock=0   WHERE id=v_bag;
  SELECT id INTO v_section FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  PERFORM upsert_recipe_v1(v_bag, v_flo, 250, 'g', NULL);
  v_r1 := record_production_v1(v_bag, 50, v_section, 'B12', 0, NULL, v_key);
  v_r2 := record_production_v1(v_bag, 50, v_section, 'B12', 0, NULL, v_key);
  SELECT COUNT(*) INTO v_dup FROM production_records WHERE idempotency_key = v_key;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_12_pass',
    CASE WHEN (v_r1->>'production_id') = (v_r2->>'production_id')
              AND (v_r2->>'idempotent_replay') = 'true'
              AND v_dup = 1 THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_12_pass') IN ('yes','skip'),
  'T_PROD_12: idempotency replay same production_id, no duplicate');

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;
-- ---------------------------------------------------------------------------
-- T_PROD_13 — MANAGER → forbidden on revert_production_v1
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_mgr UUID; v_caught TEXT; v_dummy UUID := gen_random_uuid();
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    PERFORM set_config('breakery.t_prod_13_pass','skip',true); RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  BEGIN
    PERFORM revert_production_v1(v_dummy, 'test reason');
    v_caught := 'no_raise';
  EXCEPTION WHEN OTHERS THEN v_caught := SQLERRM;
  END;
  PERFORM set_config('role','postgres',true);
  PERFORM set_config('breakery.t_prod_13_pass',
    CASE WHEN v_caught='forbidden' THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_13_pass') IN ('yes','skip'),
  'T_PROD_13: MANAGER → forbidden on revert_production_v1');

-- ---------------------------------------------------------------------------
-- T_PROD_14 — ADMIN reverts → stock restored + balanced ledger
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr UUID; v_adm UUID;
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_section UUID;
  v_pid UUID; v_result JSONB; v_revert JSONB;
  v_bag_before NUMERIC; v_flo_before NUMERIC;
  v_bag_after NUMERIC;  v_flo_after NUMERIC;
  v_reverted_at TIMESTAMPTZ;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  SELECT auth_user_id INTO v_adm FROM user_profiles WHERE employee_code='EMP000';
  IF v_mgr IS NULL OR v_adm IS NULL THEN
    PERFORM set_config('breakery.t_prod_14_pass','skip',true); RETURN;
  END IF;
  UPDATE products SET current_stock=100 WHERE id=v_flo;
  UPDATE products SET current_stock=0   WHERE id=v_bag;
  SELECT current_stock INTO v_bag_before FROM products WHERE id=v_bag;
  SELECT current_stock INTO v_flo_before FROM products WHERE id=v_flo;
  SELECT id INTO v_section FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;

  -- Isolate: T_PROD_11 left salt/yeast/water recipes active on the shared
  -- T_PROD_BAGUETTE product. Deactivate every active recipe (postgres context —
  -- authenticated has no UPDATE on recipes) so this single-ingredient production
  -- yields exactly 1 production_in + 1 production_out = 2 movements to reverse.
  UPDATE recipes SET is_active = false, deleted_at = now() WHERE product_id = v_bag AND is_active;

  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  PERFORM upsert_recipe_v1(v_bag, v_flo, 250, 'g', NULL);
  v_result := record_production_v1(v_bag, 50, v_section, NULL, 0, NULL, NULL);
  v_pid := (v_result->>'production_id')::uuid;

  PERFORM set_config('request.jwt.claim.sub', v_adm::text, true);
  v_revert := revert_production_v1(v_pid, 'pgTAP test reversal');
  PERFORM set_config('role','postgres',true);

  SELECT current_stock INTO v_bag_after FROM products WHERE id=v_bag;
  SELECT current_stock INTO v_flo_after FROM products WHERE id=v_flo;
  SELECT reverted_at INTO v_reverted_at FROM production_records WHERE id=v_pid;

  PERFORM set_config('breakery.t_prod_14_pass',
    CASE WHEN v_bag_after = v_bag_before
              AND v_flo_after = v_flo_before
              AND v_reverted_at IS NOT NULL
              AND (v_revert->>'reverse_movements_count')::int = 2
              AND (v_revert->>'reverse_je_count')::int = 2
         THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_14_pass') IN ('yes','skip'),
  'T_PROD_14: ADMIN reverts → stock restored + balanced ledger');
-- ---------------------------------------------------------------------------
-- T_PROD_15 — get_production_suggestions_v1 returns row for product with
-- recent sales + active recipe + low stock
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr UUID;
  v_bag UUID := current_setting('breakery.t_prod_baguette')::uuid;
  v_flo UUID := current_setting('breakery.t_prod_flour')::uuid;
  v_count INT;
  v_test_order UUID;
  v_session UUID;
  v_opener UUID;
BEGIN
  SELECT auth_user_id INTO v_mgr FROM user_profiles WHERE employee_code='EMP003';
  IF v_mgr IS NULL THEN
    PERFORM set_config('breakery.t_prod_15_pass','skip',true); RETURN;
  END IF;

  -- Ensure: low stock + active recipe + recent sales injected via direct INSERT.
  UPDATE products SET current_stock=2 WHERE id=v_bag;
  UPDATE products SET current_stock=100 WHERE id=v_flo;
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  PERFORM upsert_recipe_v1(v_bag, v_flo, 250, 'g', NULL);
  PERFORM set_config('role','postgres',true);

  -- POS orders now require a session_id (constraint orders_session_id_required_for_pos).
  -- Seed an open POS session for the synthetic recent-sale fixture.
  SELECT id INTO v_opener FROM user_profiles ORDER BY created_at LIMIT 1;
  INSERT INTO pos_sessions (id, opened_by, opened_at, opening_cash, status)
  VALUES (gen_random_uuid(), v_opener, NOW(), 0, 'open') RETURNING id INTO v_session;

  INSERT INTO orders (order_number, order_type, status, subtotal, tax_amount, total, created_at, created_via, session_id)
  VALUES ('T_PROD_15_O1', 'dine_in', 'completed', 50000, 0, 50000, now() - INTERVAL '1 day', 'pos', v_session)
  RETURNING id INTO v_test_order;
  INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price, quantity, line_total, created_at)
  VALUES (v_test_order, v_bag, 'Baguette', 5000, 10, 50000, now() - INTERVAL '1 day');

  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  PERFORM set_config('role','authenticated',true);
  SELECT COUNT(*) INTO v_count FROM get_production_suggestions_v1(7, 3, 7) WHERE product_id = v_bag;
  PERFORM set_config('role','postgres',true);

  PERFORM set_config('breakery.t_prod_15_pass',
    CASE WHEN v_count = 1 THEN 'yes' ELSE 'no' END, true);
END $$;
SELECT ok(current_setting('breakery.t_prod_15_pass') IN ('yes','skip'),
  'T_PROD_15: get_production_suggestions_v1 returns row for low-stock product');

SELECT * FROM finish();

ROLLBACK;
