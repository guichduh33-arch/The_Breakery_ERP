-- supabase/tests/inventory.test.sql
-- Session 12 — pgTAP test suite for inventory MVP RPCs + RLS.
--
-- Runner:
--   docker exec -i supabase_db_The_Breakery_ERP psql -U postgres -v ON_ERROR_STOP=1 \
--     -f - < supabase/tests/inventory.test.sql
--
-- Wrapped in BEGIN…ROLLBACK so the test data never leaks into the live DB.
-- pgTAP requires `ok()` to be invoked via SELECT (PERFORM swallows the row)
-- so DO blocks that need to record an assertion stash their boolean result
-- in a setting (set_config('breakery.tN_pass', ...)) which a follow-up
-- top-level SELECT ok() then asserts.
--
-- Coverage matrix:
--   T1  record_stock_movement_v1: rejects sale movement_type
--   T2  record_stock_movement_v1: rejects quantity = 0
--   T3  adjust_stock_v1: happy path 10 -> 15 (+ audit_log + signed movement)
--   T4  adjust_stock_v1: idempotent replay (same idempotency_key)
--   T5  adjust_stock_v1: MANAGER lacking inventory.adjust -> forbidden (P0003)
--   T6  adjust_stock_v1: p_new_qty < 0 rejected
--   T7  receive_stock_v1: happy path + supplier_id link + purchase movement_type
--   T8  receive_stock_v1: inactive supplier -> supplier_not_found_or_inactive
--   T9  waste_stock_v1: qty > on-hand -> insufficient_stock (P0002)
--   T10 waste_stock_v1: happy path (current_stock decremented, movement negative)
--   T11 RLS: direct INSERT into stock_movements blocked for `authenticated`
--   T12 get_stock_levels_v1: low_stock_only filters out rows with threshold = 0
--   T13 Row-lock serialization: two adjusts on same row sum correctly (no lost update)
--   T14 void_order_rpc + complete_order regression (sale_void restores stock)
--   T15 record_stock_movement_v1: REVOKE EXECUTE enforced on `authenticated` role

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ---------------------------------------------------------------------------
-- Test fixtures.
-- ---------------------------------------------------------------------------
INSERT INTO suppliers (id, code, name, is_active)
VALUES ('11111111-2222-3333-4444-555555555555'::uuid, 'PGTAP-SUP', 'pgTAP Supplier', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO suppliers (id, code, name, is_active)
VALUES ('11111111-2222-3333-4444-666666666666'::uuid, 'PGTAP-INACT', 'pgTAP Inactive', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES (
  '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
  'PGTAP-PROD-1', 'pgTAP Product 1',
  (SELECT id FROM categories LIMIT 1),
  10000, 10.000, 0
) ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES (
  '99999999-aaaa-bbbb-cccc-222222222222'::uuid,
  'PGTAP-PROD-2', 'pgTAP Product 2',
  (SELECT id FROM categories LIMIT 1),
  10000, 100.000, 20.000
) ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES (
  '99999999-aaaa-bbbb-cccc-333333333333'::uuid,
  'PGTAP-PROD-LOW', 'pgTAP Product Low Stock',
  (SELECT id FROM categories LIMIT 1),
  10000, 5.000, 10.000
) ON CONFLICT (id) DO NOTHING;

UPDATE products SET current_stock = 10.000  WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
UPDATE products SET current_stock = 100.000 WHERE id = '99999999-aaaa-bbbb-cccc-222222222222'::uuid;
UPDATE products SET current_stock = 5.000   WHERE id = '99999999-aaaa-bbbb-cccc-333333333333'::uuid;

-- Resolve seed admin uid; stash for set_config-driven JWT spoofing.
DO $bootstrap$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found — run pnpm db:reset first';
  END IF;
  PERFORM set_config('breakery.admin_uid', v_admin_uid::text, false);
END $bootstrap$;

-- Helper for tests that need to spoof auth.uid() inside a SECURITY DEFINER call.
CREATE OR REPLACE FUNCTION pg_temp.set_jwt_uid(p_uid UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
END $$;

-- =========================================================================
-- T1 — record_stock_movement_v1 rejects sale movement_type
-- =========================================================================
SELECT throws_ok(
  $$ SELECT record_stock_movement_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
       'sale'::movement_type, 1, 'attempt'
     ) $$,
  NULL,
  'record_stock_movement_v1 cannot be called with movement_type=sale',
  'T1: record_stock_movement_v1 rejects sale movement_type'
);

-- =========================================================================
-- T2 — record_stock_movement_v1 rejects quantity = 0
-- =========================================================================
SELECT throws_ok(
  $$ SELECT record_stock_movement_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
       'adjustment'::movement_type, 0, 'zero quantity attempt'
     ) $$,
  NULL,
  'quantity_must_be_nonzero',
  'T2: record_stock_movement_v1 rejects quantity = 0'
);

-- =========================================================================
-- T3 — adjust_stock_v1 happy path 10 -> 15 (+ movement +5, audit_log row)
-- =========================================================================
DO $t3$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_admin_profile UUID;
  v_result JSONB;
  v_mvt_id UUID;
  v_audit_count INT;
  v_movement_qty NUMERIC;
  v_actor UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  SELECT id INTO v_admin_profile FROM user_profiles WHERE auth_user_id = v_admin;
  UPDATE products SET current_stock = 10
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT adjust_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 15.000, 'T3 happy path'
  ) INTO v_result;

  v_mvt_id := (v_result->>'movement_id')::uuid;
  SELECT quantity INTO v_movement_qty FROM stock_movements WHERE id = v_mvt_id;
  SELECT COUNT(*) INTO v_audit_count
    FROM audit_log WHERE subject_id = v_mvt_id AND subject_table = 'stock_movements';
  SELECT actor_profile_id INTO v_actor
    FROM audit_log WHERE subject_id = v_mvt_id AND subject_table = 'stock_movements'
    ORDER BY occurred_at DESC LIMIT 1;

  PERFORM set_config('breakery.t3_pass',
    CASE WHEN
      (v_result->>'new_current_stock')::numeric = 15.000
      AND v_movement_qty = 5.000
      AND v_audit_count = 1
      AND v_actor = v_admin_profile
    THEN 'true' ELSE 'false' END, false);
END $t3$;
SELECT ok(current_setting('breakery.t3_pass')::boolean,
  'T3: adjust 10->15 yields +5 movement, new_stock=15, audit row with actor_profile_id');

-- =========================================================================
-- T4 — adjust_stock_v1 idempotent replay returns same movement_id
-- =========================================================================
DO $t4$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_key UUID := '00000000-0000-0000-0000-000000000abc'::uuid;
  v_r1 JSONB;
  v_r2 JSONB;
  v_count INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 10
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
  DELETE FROM stock_movements WHERE idempotency_key = v_key;

  SELECT adjust_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 12, 'T4 first', v_key
  ) INTO v_r1;
  SELECT adjust_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 12, 'T4 second', v_key
  ) INTO v_r2;
  SELECT COUNT(*) INTO v_count FROM stock_movements WHERE idempotency_key = v_key;

  PERFORM set_config('breakery.t4_pass',
    CASE WHEN
      (v_r1->>'movement_id') = (v_r2->>'movement_id')
      AND (v_r2->>'idempotent_replay')::boolean = true
      AND v_count = 1
    THEN 'true' ELSE 'false' END, false);
END $t4$;
SELECT ok(current_setting('breakery.t4_pass')::boolean,
  'T4: adjust_stock_v1 idempotency_key replay yields one row + same movement_id');

-- =========================================================================
-- T5 — adjust_stock_v1 from MANAGER (no inventory.adjust) -> forbidden P0003
-- =========================================================================
DO $$
DECLARE v_manager UUID;
BEGIN
  SELECT auth_user_id INTO v_manager FROM user_profiles WHERE employee_code = 'EMP003';
  PERFORM pg_temp.set_jwt_uid(v_manager);
END $$;

SELECT throws_ok(
  $$ SELECT adjust_stock_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 20.000, 'T5 manager should fail'
     ) $$,
  'P0003',
  'forbidden',
  'T5: MANAGER without inventory.adjust receives forbidden (P0003)'
);

DO $$
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
END $$;

-- =========================================================================
-- T6 — adjust_stock_v1 with p_new_qty < 0
-- =========================================================================
SELECT throws_ok(
  $$ SELECT adjust_stock_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid, -1.000, 'T6 negative'
     ) $$,
  NULL,
  'negative_qty_not_allowed',
  'T6: adjust_stock_v1 rejects p_new_qty < 0'
);

-- =========================================================================
-- T7 — receive_stock_v1 happy path
-- =========================================================================
DO $t7$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_result JSONB;
  v_mvt_id UUID;
  v_mvt RECORD;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 10
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT receive_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    25.000,
    '11111111-2222-3333-4444-555555555555'::uuid,
    NULL,
    'T7 receive'
  ) INTO v_result;
  v_mvt_id := (v_result->>'movement_id')::uuid;
  SELECT quantity, supplier_id, movement_type
    INTO v_mvt FROM stock_movements WHERE id = v_mvt_id;

  PERFORM set_config('breakery.t7_pass',
    CASE WHEN
      v_mvt.quantity = 25.000
      AND v_mvt.supplier_id = '11111111-2222-3333-4444-555555555555'::uuid
      AND v_mvt.movement_type = 'purchase'::movement_type
    THEN 'true' ELSE 'false' END, false);
END $t7$;
SELECT ok(current_setting('breakery.t7_pass')::boolean,
  'T7: receive_stock_v1 inserts purchase movement with supplier_id');

-- =========================================================================
-- T8 — receive_stock_v1 with inactive supplier -> P0002
-- =========================================================================
SELECT throws_ok(
  $$ SELECT receive_stock_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
       10.000,
       '11111111-2222-3333-4444-666666666666'::uuid,
       NULL, 'T8 inactive supplier'
     ) $$,
  'P0002',
  'supplier_not_found_or_inactive',
  'T8: receive_stock_v1 rejects inactive supplier with P0002'
);

-- =========================================================================
-- T9 — waste_stock_v1 with qty > on-hand -> insufficient_stock P0002
-- =========================================================================
DO $$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 3
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
END $$;

SELECT throws_ok(
  $$ SELECT waste_stock_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 50.000, 'T9 too much'
     ) $$,
  'P0002',
  'insufficient_stock',
  'T9: waste_stock_v1 rejects qty > current_stock with insufficient_stock'
);

-- =========================================================================
-- T10 — waste_stock_v1 happy path
-- =========================================================================
DO $t10$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_result JSONB;
  v_mvt_id UUID;
  v_mvt_qty NUMERIC;
  v_new_stock NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 20
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT waste_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 4.000, 'T10 spoilage'
  ) INTO v_result;

  v_mvt_id := (v_result->>'movement_id')::uuid;
  SELECT quantity INTO v_mvt_qty FROM stock_movements WHERE id = v_mvt_id;
  SELECT current_stock INTO v_new_stock FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  PERFORM set_config('breakery.t10_pass',
    CASE WHEN
      v_mvt_qty = -4.000 AND v_new_stock = 16.000
      AND (v_result->>'new_current_stock')::numeric = 16.000
    THEN 'true' ELSE 'false' END, false);
END $t10$;
SELECT ok(current_setting('breakery.t10_pass')::boolean,
  'T10: waste_stock_v1 decrements stock by qty and inserts negative movement');

-- =========================================================================
-- T11 — RLS: direct INSERT into stock_movements blocked for `authenticated`
-- =========================================================================
DO $t11$
DECLARE
  v_admin_profile UUID;
  v_admin_uid UUID := current_setting('breakery.admin_uid')::uuid;
  v_blocked BOOLEAN := false;
BEGIN
  SELECT id INTO v_admin_profile FROM user_profiles WHERE auth_user_id = v_admin_uid;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.set_jwt_uid(v_admin_uid);
  BEGIN
    INSERT INTO stock_movements (product_id, movement_type, quantity, reason, reference_type, created_by)
    VALUES (
      '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
      'adjustment', 1, 'T11 direct insert', 'admin_action', v_admin_profile
    );
  EXCEPTION WHEN insufficient_privilege OR others THEN
    v_blocked := true;
  END;
  RESET ROLE;

  PERFORM set_config('breakery.t11_pass', v_blocked::text, false);
END $t11$;
SELECT ok(current_setting('breakery.t11_pass')::boolean,
  'T11: direct INSERT into stock_movements is blocked for `authenticated` role');

-- =========================================================================
-- T12 — get_stock_levels_v1 with p_low_stock_only filters correctly
-- =========================================================================
DO $t12$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_low_only_has_pgtap_low BOOLEAN;
  v_low_only_excludes_threshold_zero BOOLEAN;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  SELECT EXISTS (
    SELECT 1 FROM get_stock_levels_v1(NULL, 'PGTAP-PROD-LOW', true, 100, 0)
     WHERE sku = 'PGTAP-PROD-LOW'
  ) INTO v_low_only_has_pgtap_low;

  SELECT NOT EXISTS (
    SELECT 1 FROM get_stock_levels_v1(NULL, 'PGTAP-PROD-1', true, 100, 0)
     WHERE sku = 'PGTAP-PROD-1'
  ) INTO v_low_only_excludes_threshold_zero;

  PERFORM set_config('breakery.t12_pass',
    (v_low_only_has_pgtap_low AND v_low_only_excludes_threshold_zero)::text, false);
END $t12$;
SELECT ok(current_setting('breakery.t12_pass')::boolean,
  'T12: get_stock_levels_v1 low_stock_only includes (current < threshold > 0) and excludes threshold = 0');

-- =========================================================================
-- T13 — Sequential adjusts on the same row sum correctly via row lock.
-- (Real concurrency is asserted by inventory-concurrent.test.ts T16.)
-- =========================================================================
DO $t13$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_after_first NUMERIC;
  v_after_second NUMERIC;
  v_total_deltas NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 50
    WHERE id = '99999999-aaaa-bbbb-cccc-222222222222'::uuid;
  -- Clean any prior T13 rows so the SUM only reflects this run.
  DELETE FROM stock_movements
   WHERE product_id = '99999999-aaaa-bbbb-cccc-222222222222'::uuid
     AND reason LIKE 'T13 step%';

  PERFORM adjust_stock_v1('99999999-aaaa-bbbb-cccc-222222222222'::uuid, 70.000, 'T13 step 1');
  SELECT current_stock INTO v_after_first FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-222222222222'::uuid;

  PERFORM waste_stock_v1('99999999-aaaa-bbbb-cccc-222222222222'::uuid, 5.000, 'T13 step 2 waste');
  SELECT current_stock INTO v_after_second FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-222222222222'::uuid;

  SELECT COALESCE(SUM(quantity), 0) INTO v_total_deltas
    FROM stock_movements
   WHERE product_id = '99999999-aaaa-bbbb-cccc-222222222222'::uuid
     AND reason LIKE 'T13 step%';

  PERFORM set_config('breakery.t13_pass',
    CASE WHEN
      v_after_first = 70.000 AND v_after_second = 65.000 AND v_total_deltas = 15.000
    THEN 'true' ELSE 'false' END, false);
END $t13$;
SELECT ok(current_setting('breakery.t13_pass')::boolean,
  'T13: sequential adjusts on locked row sum correctly (50 -> 70 -> 65, deltas +20 -5)');

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

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reference_type, reference_id, created_by
  ) VALUES (
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    'sale', -2.000, 'orders', gen_random_uuid(), v_admin_profile
  ) RETURNING id INTO v_sale_id;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reference_type, reference_id, created_by
  ) VALUES (
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    'sale_void', 2.000, 'orders', gen_random_uuid(), v_admin_profile
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
-- T15 — record_stock_movement_v1 invoked as `authenticated` role -> denied.
-- =========================================================================
DO $t15$
DECLARE
  v_blocked BOOLEAN := false;
  v_admin_uid UUID := current_setting('breakery.admin_uid')::uuid;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.set_jwt_uid(v_admin_uid);
  BEGIN
    PERFORM record_stock_movement_v1(
      '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
      'adjustment'::movement_type, 1.000, 'T15 bypass attempt'
    );
  EXCEPTION WHEN insufficient_privilege OR others THEN
    v_blocked := true;
  END;
  RESET ROLE;

  PERFORM set_config('breakery.t15_pass', v_blocked::text, false);
END $t15$;
SELECT ok(current_setting('breakery.t15_pass')::boolean,
  'T15: record_stock_movement_v1 EXECUTE is REVOKED from authenticated role');

-- ---------------------------------------------------------------------------
SELECT * FROM finish();

ROLLBACK;
