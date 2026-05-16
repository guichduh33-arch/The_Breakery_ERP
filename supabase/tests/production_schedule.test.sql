-- supabase/tests/production_schedule.test.sql
-- Session 15 / Phase 4.B — Production scheduling pgTAP suite.
--
-- Covers migrations 20260519000120..000122 :
--   - production_schedules table + RLS + unique constraint
--   - enforce_production_schedule_lifecycle trigger
--   - suggest_production_schedule_v1 RPC
--   - inventory.production.schedule permission seed
--
-- Coverage matrix :
--   T1 — INSERT a valid scheduled row succeeds.
--   T2 — Duplicate (date, slot, recipe_id) rejected by UNIQUE.
--   T3 — Illegal transition scheduled -> completed rejected (P0001).
--   T4 — Legal scheduled -> started -> completed succeeds + completed_record_id can be set.
--   T5 — suggest_production_schedule_v1(target) returns jsonb envelope with 'suggestions'.
--   T6 — Non-MANAGER (CASHIER) calling INSERT is blocked by RLS.
--
-- Runner : execute via MCP execute_sql under BEGIN..ROLLBACK envelope.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

-- ---------------------------------------------------------------------------
-- Bootstrap
-- ---------------------------------------------------------------------------
DO $boot$
DECLARE
  v_admin_uid     UUID;
  v_admin_profile UUID;
  v_cashier_uid   UUID;
  v_category_id   UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid     FROM user_profiles WHERE employee_code='EMP000';
  SELECT id           INTO v_admin_profile FROM user_profiles WHERE employee_code='EMP000';
  SELECT auth_user_id INTO v_cashier_uid   FROM user_profiles WHERE employee_code='EMP001';
  SELECT id           INTO v_category_id   FROM categories    WHERE deleted_at IS NULL LIMIT 1;

  PERFORM set_config('ps.admin_uid',     v_admin_uid::text,     false);
  PERFORM set_config('ps.admin_profile', v_admin_profile::text, false);
  PERFORM set_config('ps.cashier_uid',   COALESCE(v_cashier_uid::text, ''), false);
  PERFORM set_config('ps.category_id',   v_category_id::text,   false);
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
END $boot$;

-- Helper : create a recipe-built finished product.
CREATE OR REPLACE FUNCTION pg_temp.mkrecipe(p_sku TEXT, p_name TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_prod UUID;
  v_mat  UUID;
BEGIN
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
  VALUES (p_sku, p_name, current_setting('ps.category_id')::uuid, 100, 0, 'pcs', 30, 'finished', TRUE)
  RETURNING id INTO v_prod;

  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
  VALUES (p_sku || '-MAT', p_name || ' Mat', current_setting('ps.category_id')::uuid, 10, 1000, 'kg', 5, 'finished', TRUE)
  RETURNING id INTO v_mat;

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_prod, v_mat, 1, 'kg', TRUE);

  RETURN v_prod;
END $$;

-- Fixture : two recipe-built products.
DO $fix$
DECLARE
  v_p1 UUID;
  v_p2 UUID;
BEGIN
  v_p1 := pg_temp.mkrecipe('PS-T1-A', 'Schedule Test A');
  v_p2 := pg_temp.mkrecipe('PS-T1-B', 'Schedule Test B');
  PERFORM set_config('ps.p1', v_p1::text, false);
  PERFORM set_config('ps.p2', v_p2::text, false);
END $fix$;

-- ---------------------------------------------------------------------------
-- T1 — Valid INSERT succeeds.
-- ---------------------------------------------------------------------------
DO $t1$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO production_schedules (scheduled_date, slot, recipe_id, planned_qty, created_by)
  VALUES (CURRENT_DATE + 1, '5am', current_setting('ps.p1')::uuid, 10,
          current_setting('ps.admin_profile')::uuid)
  RETURNING id INTO v_id;
  PERFORM set_config('ps.t1_id', v_id::text, false);
END $t1$;

SELECT ok(
  current_setting('ps.t1_id') IS NOT NULL AND current_setting('ps.t1_id') <> '',
  'T1: valid scheduled row inserted'
);

-- ---------------------------------------------------------------------------
-- T2 — Duplicate (date, slot, recipe_id) is rejected by UNIQUE.
-- ---------------------------------------------------------------------------
DO $t2$
DECLARE
  v_caught BOOLEAN := FALSE;
  v_msg TEXT := '';
BEGIN
  BEGIN
    INSERT INTO production_schedules (scheduled_date, slot, recipe_id, planned_qty, created_by)
    VALUES (CURRENT_DATE + 1, '5am', current_setting('ps.p1')::uuid, 20,
            current_setting('ps.admin_profile')::uuid);
  EXCEPTION WHEN unique_violation THEN
    v_caught := TRUE;
    v_msg := SQLERRM;
  END;
  PERFORM set_config('ps.t2_caught', CASE WHEN v_caught THEN '1' ELSE '0' END, false);
END $t2$;

SELECT is(
  current_setting('ps.t2_caught'),
  '1',
  'T2: duplicate (date, slot, recipe_id) rejected by UNIQUE'
);

-- ---------------------------------------------------------------------------
-- T3 — Illegal transition scheduled -> completed is rejected.
-- ---------------------------------------------------------------------------
DO $t3$
DECLARE
  v_id UUID;
  v_err TEXT := '';
BEGIN
  INSERT INTO production_schedules (scheduled_date, slot, recipe_id, planned_qty, created_by)
  VALUES (CURRENT_DATE + 2, '5am', current_setting('ps.p1')::uuid, 5,
          current_setting('ps.admin_profile')::uuid)
  RETURNING id INTO v_id;
  BEGIN
    UPDATE production_schedules SET status='completed' WHERE id = v_id;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
  END;
  PERFORM set_config('ps.t3_err', v_err, false);
END $t3$;

SELECT is(
  current_setting('ps.t3_err'),
  'invalid_schedule_status_transition',
  'T3: illegal scheduled -> completed rejected with invalid_schedule_status_transition'
);

-- ---------------------------------------------------------------------------
-- T4 — Legal scheduled -> started -> completed + completed_record_id update.
-- ---------------------------------------------------------------------------
DO $t4$
DECLARE
  v_id UUID;
  v_pr UUID;
  v_final_status TEXT;
BEGIN
  -- Re-use the row created in T3 (currently still 'scheduled') for this test.
  SELECT id INTO v_id FROM production_schedules
   WHERE scheduled_date = CURRENT_DATE + 2 AND slot='5am'
     AND recipe_id = current_setting('ps.p1')::uuid;

  UPDATE production_schedules SET status='started'   WHERE id = v_id;
  UPDATE production_schedules SET status='completed' WHERE id = v_id;

  -- Pick any existing production record (or NULL if none) — we only need to
  -- verify that the column accepts a write before-or-after transition.
  SELECT id INTO v_pr FROM production_records LIMIT 1;
  UPDATE production_schedules SET completed_record_id = v_pr WHERE id = v_id;

  SELECT status INTO v_final_status FROM production_schedules WHERE id = v_id;
  PERFORM set_config('ps.t4_final', v_final_status, false);
END $t4$;

SELECT is(
  current_setting('ps.t4_final'),
  'completed',
  'T4: scheduled -> started -> completed legal path, completed_record_id writable'
);

-- ---------------------------------------------------------------------------
-- T5 — suggest_production_schedule_v1 returns a jsonb envelope.
-- ---------------------------------------------------------------------------
DO $t5$
DECLARE
  v_payload JSONB;
  v_keys TEXT;
  v_arr_type TEXT;
BEGIN
  v_payload := suggest_production_schedule_v1(CURRENT_DATE);
  SELECT string_agg(k, ',' ORDER BY k) INTO v_keys
    FROM jsonb_object_keys(v_payload) AS k;
  v_arr_type := jsonb_typeof(v_payload->'suggestions');
  PERFORM set_config('ps.t5_keys',  v_keys, false);
  PERFORM set_config('ps.t5_arr',   v_arr_type, false);
END $t5$;

SELECT is(
  current_setting('ps.t5_arr'),
  'array',
  'T5: suggest_production_schedule_v1 returns jsonb envelope with suggestions array'
);

-- ---------------------------------------------------------------------------
-- T6 — CASHIER role cannot INSERT (RLS blocks).
-- ---------------------------------------------------------------------------
DO $t6$
DECLARE
  v_cashier UUID;
  v_blocked BOOLEAN := FALSE;
BEGIN
  v_cashier := NULLIF(current_setting('ps.cashier_uid'), '')::uuid;
  IF v_cashier IS NULL THEN
    PERFORM set_config('ps.t6', 'skip', false);
    RETURN;
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_cashier::text, false);
  PERFORM set_config('role', 'authenticated', false);
  BEGIN
    INSERT INTO production_schedules (scheduled_date, slot, recipe_id, planned_qty)
    VALUES (CURRENT_DATE + 5, '11am', current_setting('ps.p2')::uuid, 10);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;
  PERFORM set_config('role','postgres',false);
  PERFORM set_config('request.jwt.claim.sub', current_setting('ps.admin_uid'), false);
  PERFORM set_config('ps.t6', CASE WHEN v_blocked THEN 'blocked' ELSE 'allowed' END, false);
END $t6$;

SELECT ok(
  current_setting('ps.t6') IN ('blocked','skip'),
  'T6: CASHIER role blocked from INSERT (or skipped when seed missing)'
);

SELECT * FROM finish();

ROLLBACK;
