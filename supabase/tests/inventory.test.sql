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
--   T3  adjust_stock_v1: happy path 10 -> 15 (+ audit_logs + signed movement)
--   T4  adjust_stock_v1: idempotent replay (same idempotency_key)
--   T5  adjust_stock_v1: MANAGER lacking inventory.adjust -> forbidden (P0003)
--   T6  adjust_stock_v1: p_new_qty < 0 rejected
--   T7  receive_stock_v1 est DROPPÉE (Q3 audit 2026-07-27 — réception valorisée
--       via le flux PO/achat direct uniquement)
--   T8  record_incoming_stock_v1 existe toujours (entrées non-achat conservées)
--   T9  waste_stock_v1: qty > on-hand -> insufficient_stock (P0002)
--   T10 waste_stock_v1: happy path (current_stock decremented, movement negative)
--   T11 RLS: direct INSERT into stock_movements blocked for `authenticated`
--   T12 get_stock_levels_v4: bucket 'low' filters out rows with threshold = 0
--   T13 Row-lock serialization: two adjusts on same row sum correctly (no lost update)
--   T14 void_order_rpc + complete_order regression (sale_void restores stock)
--   T15 record_stock_movement_v1: REVOKE EXECUTE enforced on `authenticated` role
--   T16 record_incoming_stock_v1: CASHIER -> forbidden (P0003)
--   T17 record_incoming_stock_v1: MANAGER + qty 0 -> quantity_must_be_positive
--   T18 record_incoming_stock_v1: MANAGER happy path (no supplier) — movement row +
--       current_stock bump + audit row
--   T19 record_incoming_stock_v1: MANAGER + soft-deleted supplier -> P0002
--   T20 record_incoming_stock_v1: idempotent replay (same key, identical args)
--   T21 get_stock_counters_v1: total independent of the page window, and readable on an empty result
--   T22 get_stock_levels_v4: search is case-insensitive (ILIKE) — upper/lower both match
--   T23 get_stock_levels_v4: p_category_id filter returns only matching products
--   T24 get_stock_levels_v4: bucket 'low' excludes products with current_stock >= threshold (threshold>0)
--   T25 adjust_stock_v1: p_new_qty=0 sets stock to 0 and emits negative delta movement
--   T26 adjust_stock_v1: idempotent replay with different reason still returns original movement_id
--   T27 waste_stock_v1: reason shorter than 3 chars rejected with reason_required
--   T28 waste_stock_v1: qty > current_stock rejected with insufficient_stock (P0002) — distinct product
--   T41 ADR-024: counters equal the row count of get_stock_levels_v4 for every bucket
--   T42 ADR-024: CASHIER -> forbidden P0003 on get_stock_counters_v1 (negative gate)
--
-- ADR-027 (2026-08-16) : T29-T40 (create/receive/cancel_internal_transfer_v1 +
-- section_stock + RLS internal_transfers) supprimés — feature transferts et ses
-- tables droppées, mono-section. Les numéros T29-T40 restent VACANTS (pas de
-- renumérotation) pour ne pas fausser l'historique des diffs ; T41/T42 gardent
-- leur numéro d'origine.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(30);

-- ---------------------------------------------------------------------------
-- Test fixtures.
-- ---------------------------------------------------------------------------
INSERT INTO suppliers (id, code, name, is_active)
VALUES ('11111111-2222-3333-4444-555555555555'::uuid, 'PGTAP-SUP', 'pgTAP Supplier', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO suppliers (id, code, name, is_active)
VALUES ('11111111-2222-3333-4444-666666666666'::uuid, 'PGTAP-INACT', 'pgTAP Inactive', false)
ON CONFLICT (id) DO NOTHING;

-- Soft-deleted supplier fixture for T19 (record_incoming_stock_v1).
INSERT INTO suppliers (id, code, name, is_active, deleted_at)
VALUES (
  '11111111-2222-3333-4444-777777777777'::uuid,
  'PGTAP-DEL', 'pgTAP Soft-Deleted', true, now()
) ON CONFLICT (id) DO NOTHING;
-- Re-assert deleted_at in case the row was created by a prior run as active.
UPDATE suppliers SET deleted_at = now(), is_active = true
 WHERE id = '11111111-2222-3333-4444-777777777777'::uuid;

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
-- The project-wide anon/PUBLIC hardening (ALTER DEFAULT PRIVILEGES FOR ROLE
-- postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC) strips PUBLIC EXECUTE from
-- newly created functions — including this pg_temp helper — which makes the
-- nightly runner (non-owner role) fail with "permission denied for function
-- set_jwt_uid". Re-grant EXECUTE explicitly so the helper is callable whatever
-- role runs the suite.
GRANT EXECUTE ON FUNCTION pg_temp.set_jwt_uid(UUID) TO PUBLIC;

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
-- T3 — adjust_stock_v1 happy path 10 -> 15 (+ movement +5, audit_logs row)
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
    FROM audit_logs WHERE entity_id = v_mvt_id AND entity_type = 'stock_movements';
  SELECT actor_id INTO v_actor
    FROM audit_logs WHERE entity_id = v_mvt_id AND entity_type = 'stock_movements'
    ORDER BY created_at DESC LIMIT 1;

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
-- T7 — receive_stock_v1 est droppée (Q3 audit 2026-07-27) : la réception
-- valorisée passe exclusivement par le flux PO / achat direct
-- (receive_purchase_order_v4), seule voie qui aligne stock + WAC + JE.
-- =========================================================================
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'receive_stock_v1'
  ),
  'T7: receive_stock_v1 is dropped (valued receipts go through the PO flow)');

-- =========================================================================
-- T8 — record_incoming_stock_v1 existe toujours (entrées non-achat : stock
-- initial d'un site migré, etc. — conservée par décision Q3).
-- =========================================================================
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_incoming_stock_v1'
  ),
  'T8: record_incoming_stock_v1 still exists (non-purchase entries kept)');

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
-- T12 — get_stock_levels_v4 with p_bucket = 'low' filters correctly
-- =========================================================================
DO $t12$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_low_only_has_pgtap_low BOOLEAN;
  v_low_only_excludes_threshold_zero BOOLEAN;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  SELECT EXISTS (
    SELECT 1 FROM get_stock_levels_v4(NULL, 'PGTAP-PROD-LOW', 'low', 100, 0)
     WHERE sku = 'PGTAP-PROD-LOW'
  ) INTO v_low_only_has_pgtap_low;

  SELECT NOT EXISTS (
    SELECT 1 FROM get_stock_levels_v4(NULL, 'PGTAP-PROD-1', 'low', 100, 0)
     WHERE sku = 'PGTAP-PROD-1'
  ) INTO v_low_only_excludes_threshold_zero;

  PERFORM set_config('breakery.t12_pass',
    (v_low_only_has_pgtap_low AND v_low_only_excludes_threshold_zero)::text, false);
END $t12$;
SELECT ok(current_setting('breakery.t12_pass')::boolean,
  'T12: get_stock_levels_v4 bucket low includes (current < threshold > 0) and excludes threshold = 0');

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
-- T16 — record_incoming_stock_v1 from CASHIER (no inventory.receive) -> P0003
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
  $$ SELECT record_incoming_stock_v1(
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
-- T17 — record_incoming_stock_v1 with quantity = 0 -> quantity_must_be_positive
-- =========================================================================
SELECT throws_ok(
  $$ SELECT record_incoming_stock_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
       0,
       NULL, NULL, 'T17 zero qty'
     ) $$,
  NULL,
  'quantity_must_be_positive',
  'T17: MANAGER + qty=0 rejected with quantity_must_be_positive'
);

-- =========================================================================
-- T18 — record_incoming_stock_v1 MANAGER happy path (no supplier, qty 5):
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

  SELECT record_incoming_stock_v1(
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
-- T19 — record_incoming_stock_v1 with soft-deleted supplier -> P0002
-- =========================================================================
SELECT throws_ok(
  $$ SELECT record_incoming_stock_v1(
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
-- T20 — record_incoming_stock_v1 idempotent replay (same idempotency_key):
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

  SELECT record_incoming_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    7.000,
    NULL, NULL, 'T20 first', v_key
  ) INTO v_r1;
  SELECT current_stock INTO v_after_first FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT record_incoming_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid,
    7.000,
    NULL, NULL, 'T20 second (replay)', v_key
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
  'T20: record_incoming_stock_v1 idempotency replay yields one row + idempotent_replay=true + stock bumped once');

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

-- =========================================================================
-- T25 — adjust_stock_v1 p_new_qty=0 is allowed (sets stock exactly to 0).
-- Setup: PGTAP-PROD-1 to 5; adjust to 0; expect movement quantity = -5.
-- =========================================================================
DO $t25$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_result JSONB;
  v_mvt_id UUID;
  v_mvt_qty NUMERIC;
  v_new_stock NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 5
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  SELECT adjust_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 0.000, 'T25 set to zero'
  ) INTO v_result;

  v_mvt_id := (v_result->>'movement_id')::uuid;
  SELECT quantity INTO v_mvt_qty FROM stock_movements WHERE id = v_mvt_id;
  SELECT current_stock INTO v_new_stock FROM products
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;

  PERFORM set_config('breakery.t25_pass',
    CASE WHEN
      v_mvt_qty = -5.000
      AND v_new_stock = 0.000
      AND (v_result->>'new_current_stock')::numeric = 0.000
    THEN 'true' ELSE 'false' END, false);
END $t25$;
SELECT ok(current_setting('breakery.t25_pass')::boolean,
  'T25: adjust_stock_v1(p_new_qty=0) accepted — stock becomes 0, movement quantity = -5');

-- =========================================================================
-- T26 — adjust_stock_v1 idempotency replay with a DIFFERENT reason but the
-- SAME idempotency_key still returns the original movement_id and does NOT
-- mutate the stored reason (replay short-circuits before re-inserting).
-- =========================================================================
DO $t26$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_key   UUID := '00000000-0000-0000-0000-000000000a26'::uuid;
  v_r1    JSONB;
  v_r2    JSONB;
  v_row_count INT;
  v_stored_reason TEXT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE products SET current_stock = 10
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
  DELETE FROM stock_movements WHERE idempotency_key = v_key;

  SELECT adjust_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 13, 'T26 original reason', v_key
  ) INTO v_r1;
  SELECT adjust_stock_v1(
    '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 13, 'T26 DIFFERENT reason on replay', v_key
  ) INTO v_r2;
  SELECT COUNT(*) INTO v_row_count FROM stock_movements WHERE idempotency_key = v_key;
  SELECT reason INTO v_stored_reason FROM stock_movements WHERE idempotency_key = v_key;

  PERFORM set_config('breakery.t26_pass',
    CASE WHEN
      (v_r1->>'movement_id') = (v_r2->>'movement_id')
      AND (v_r2->>'idempotent_replay')::boolean = true
      AND v_row_count = 1
      AND v_stored_reason = 'T26 original reason'
    THEN 'true' ELSE 'false' END, false);
END $t26$;
SELECT ok(current_setting('breakery.t26_pass')::boolean,
  'T26: adjust_stock_v1 idempotency replay with different reason returns original movement_id (reason unchanged)');

-- =========================================================================
-- T27 — waste_stock_v1 with short reason (< 3 chars) -> reason_required
-- =========================================================================
DO $$
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
  UPDATE products SET current_stock = 20
    WHERE id = '99999999-aaaa-bbbb-cccc-111111111111'::uuid;
END $$;

SELECT throws_ok(
  $$ SELECT waste_stock_v1(
       '99999999-aaaa-bbbb-cccc-111111111111'::uuid, 1.000, 'ab'
     ) $$,
  NULL,
  'reason_required',
  'T27: waste_stock_v1 rejects reason shorter than 3 chars with reason_required'
);

-- =========================================================================
-- T28 — waste_stock_v1 qty > current_stock -> insufficient_stock P0002
-- Uses PGTAP-PROD-LOW (stock=5) to keep PGTAP-PROD-1 state independent.
-- =========================================================================
DO $$
BEGIN
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
  UPDATE products SET current_stock = 5
    WHERE id = '99999999-aaaa-bbbb-cccc-333333333333'::uuid;
END $$;

SELECT throws_ok(
  $$ SELECT waste_stock_v1(
       '99999999-aaaa-bbbb-cccc-333333333333'::uuid, 100.000, 'T28 over-waste'
     ) $$,
  'P0002',
  'insufficient_stock',
  'T28: waste_stock_v1 rejects qty > current_stock with insufficient_stock (distinct product)'
);

-- =========================================================================
-- ADR-027 : T29-T40 (create/receive/cancel_internal_transfer_v1, RLS sur
-- internal_transfers, permission gate inventory.transfer.*) supprimés —
-- feature transferts + tables section_stock/internal_transfers/transfer_items
-- droppées. Numéros laissés vacants (voir note d'en-tête).
-- =========================================================================

-- =========================================================================
-- T41 — ADR-024 déc. 4 : parité compteurs / lignes, panier par panier.
-- C'est LE garde-fou de la décision 1 : les règles de sélection du catalogue
-- vivent dans deux fonctions, et une règle ajoutée à l'une sans l'autre ferait
-- annoncer un nombre que la liste contredit. Ce test refuse la fusion.
-- =========================================================================
DO $t41$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  c RECORD;
  v_all BIGINT; v_low BIGINT; v_zero BIGINT; v_neg BIGINT; v_untracked BIGINT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  SELECT * INTO c FROM get_stock_counters_v1(NULL, NULL);

  SELECT COUNT(*) INTO v_all       FROM get_stock_levels_v4(NULL, NULL, 'all',       100000, 0);
  SELECT COUNT(*) INTO v_low       FROM get_stock_levels_v4(NULL, NULL, 'low',       100000, 0);
  SELECT COUNT(*) INTO v_zero      FROM get_stock_levels_v4(NULL, NULL, 'zero',      100000, 0);
  SELECT COUNT(*) INTO v_neg       FROM get_stock_levels_v4(NULL, NULL, 'negative',  100000, 0);
  SELECT COUNT(*) INTO v_untracked FROM get_stock_levels_v4(NULL, NULL, 'untracked', 100000, 0);

  PERFORM set_config('breakery.t41_pass',
    (c.total_count     = v_all
     AND c.low_count       = v_low
     AND c.zero_count      = v_zero
     AND c.negative_count  = v_neg
     AND c.untracked_count = v_untracked)::text, false);
END $t41$;
SELECT ok(current_setting('breakery.t41_pass')::boolean,
  'T41: get_stock_counters_v1 equals the row count of get_stock_levels_v4 for every bucket');

-- =========================================================================
-- T42 — ADR-021 déc. 6 : toute garde ajoutée porte son test NÉGATIF. La
-- fonction de compteurs est neuve ; prouver qu'elle répond ne suffit pas, il
-- faut prouver qu'elle refuse.
-- =========================================================================
DO $t42$
DECLARE
  v_cashier UUID;
  v_blocked BOOLEAN := false;
BEGIN
  SELECT auth_user_id INTO v_cashier FROM user_profiles WHERE employee_code = 'EMP001';
  PERFORM pg_temp.set_jwt_uid(v_cashier);
  BEGIN
    PERFORM * FROM get_stock_counters_v1(NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := (SQLSTATE = 'P0003' AND SQLERRM = 'forbidden');
  END;
  PERFORM set_config('breakery.t42_pass', v_blocked::text, false);
  PERFORM pg_temp.set_jwt_uid(current_setting('breakery.admin_uid')::uuid);
END $t42$;
SELECT ok(current_setting('breakery.t42_pass')::boolean,
  'T42: CASHIER without inventory.read receives forbidden (P0003) from get_stock_counters_v1');

-- ---------------------------------------------------------------------------
SELECT * FROM finish();

ROLLBACK;
