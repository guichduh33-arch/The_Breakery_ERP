-- supabase/tests/margin_alerts.test.sql
-- Session 15 / Phase 5.A — margin_alerts pgTAP suite.
--
-- Coverage matrix :
--   T1 — recompute opens a new alert with the correct delta_pct.
--   T2 — recompute is idempotent (no new row, existing row updated).
--   T3 — recovery : cost drops back inside target → open alert auto-closed.
--   T4 — acknowledging an alert allows a fresh open alert on the same product.
--   T5 — RLS / column-guard : authenticated cannot touch non-ack columns.
--
-- Runner : execute via MCP execute_sql under BEGIN..ROLLBACK envelope.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

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

  PERFORM set_config('ma.admin_uid',     v_admin_uid::text,     false);
  PERFORM set_config('ma.admin_profile', v_admin_profile::text, false);
  PERFORM set_config('ma.cashier_uid',   COALESCE(v_cashier_uid::text, ''), false);
  PERFORM set_config('ma.category_id',   v_category_id::text,   false);
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
END $boot$;

-- Helper : create a recipe-built finished product with a chosen target,
-- price, and material cost. Returns (product_id, material_id).
CREATE OR REPLACE FUNCTION pg_temp.mkmargprod(
  p_sku TEXT, p_name TEXT,
  p_price NUMERIC, p_target NUMERIC, p_material_cost NUMERIC
)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  v_prod UUID;
  v_mat  UUID;
BEGIN
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, target_gross_margin_pct)
  VALUES (p_sku, p_name, current_setting('ma.category_id')::uuid, p_price, 0, 'pcs', 0, 'finished', TRUE, p_target)
  RETURNING id INTO v_prod;

  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
  VALUES (p_sku || '-MAT', p_name || ' Mat', current_setting('ma.category_id')::uuid, 0, 1000, 'kg', p_material_cost, 'finished', TRUE)
  RETURNING id INTO v_mat;

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_prod, v_mat, 1, 'kg', TRUE);

  RETURN v_prod;
END $$;

-- ---------------------------------------------------------------------------
-- T1 — Breaching product creates an alert with the correct delta.
-- Price 10_000, cost 8_000 → expected margin = 20%, target = 60% → delta = -40%.
-- ---------------------------------------------------------------------------
DO $t1$
DECLARE
  v_pid UUID;
  v_delta NUMERIC;
  v_exp NUMERIC;
BEGIN
  v_pid := pg_temp.mkmargprod('MA-T1', 'Margin Test 1', 10000, 60.00, 8000);
  PERFORM set_config('ma.t1_pid', v_pid::text, false);
  PERFORM recompute_recipe_margins_v1();
  SELECT delta_pct, expected_margin_pct INTO v_delta, v_exp
    FROM margin_alerts
   WHERE product_id = v_pid AND acknowledged_at IS NULL;
  PERFORM set_config('ma.t1_delta', v_delta::text, false);
  PERFORM set_config('ma.t1_exp',   v_exp::text,   false);
END $t1$;

SELECT is(
  current_setting('ma.t1_delta'),
  '-40.00',
  'T1: open alert created with delta_pct = -40.00 (expected 20%% vs target 60%%)'
);

-- ---------------------------------------------------------------------------
-- T2 — Re-running the recompute does NOT open a new alert (idempotent).
-- ---------------------------------------------------------------------------
DO $t2$
DECLARE
  v_count_before INT;
  v_count_after  INT;
BEGIN
  SELECT count(*) INTO v_count_before FROM margin_alerts WHERE product_id = current_setting('ma.t1_pid')::uuid;
  PERFORM recompute_recipe_margins_v1();
  SELECT count(*) INTO v_count_after  FROM margin_alerts WHERE product_id = current_setting('ma.t1_pid')::uuid;
  PERFORM set_config('ma.t2_before', v_count_before::text, false);
  PERFORM set_config('ma.t2_after',  v_count_after::text,  false);
END $t2$;

SELECT is(
  current_setting('ma.t2_after'),
  current_setting('ma.t2_before'),
  'T2: re-running recompute does not duplicate an open alert (idempotent)'
);

-- ---------------------------------------------------------------------------
-- T3 — Recovery : drop the material cost so expected margin >= target → the
-- open alert is auto-closed (acknowledged_at populated).
-- ---------------------------------------------------------------------------
DO $t3$
DECLARE
  v_pid UUID := current_setting('ma.t1_pid')::uuid;
  v_mat UUID;
  v_ack TIMESTAMPTZ;
BEGIN
  SELECT material_id INTO v_mat FROM recipes WHERE product_id = v_pid LIMIT 1;
  -- Set cost to 1_000 → margin = 90% > 60% → recovered.
  UPDATE products SET cost_price = 1000 WHERE id = v_mat;
  PERFORM recompute_recipe_margins_v1();
  SELECT acknowledged_at INTO v_ack
    FROM margin_alerts
   WHERE product_id = v_pid
   ORDER BY computed_at DESC LIMIT 1;
  PERFORM set_config('ma.t3_ack', CASE WHEN v_ack IS NULL THEN 'open' ELSE 'closed' END, false);
END $t3$;

SELECT is(
  current_setting('ma.t3_ack'),
  'closed',
  'T3: cost dropped → open alert auto-recovered (acknowledged_at set)'
);

-- ---------------------------------------------------------------------------
-- T4 — Acknowledging an alert frees the partial unique slot — a fresh breach
-- can open a NEW alert for the same product.
-- ---------------------------------------------------------------------------
DO $t4$
DECLARE
  v_pid UUID;
  v_mat UUID;
  v_count INT;
BEGIN
  v_pid := pg_temp.mkmargprod('MA-T4', 'Margin Test 4', 10000, 60.00, 8000);
  PERFORM recompute_recipe_margins_v1();
  -- ack the open alert
  UPDATE margin_alerts SET acknowledged_at = now(), notes = 'ack by test'
   WHERE product_id = v_pid AND acknowledged_at IS NULL;
  -- recompute again — another open alert should now exist
  PERFORM recompute_recipe_margins_v1();
  SELECT count(*) INTO v_count FROM margin_alerts
   WHERE product_id = v_pid AND acknowledged_at IS NULL;
  PERFORM set_config('ma.t4_open_after_ack', v_count::text, false);
END $t4$;

SELECT is(
  current_setting('ma.t4_open_after_ack'),
  '1',
  'T4: after ack, a fresh recompute reopens a NEW alert on the same product'
);

-- ---------------------------------------------------------------------------
-- T5 — Column-guard trigger : an authenticated (non-postgres) caller cannot
-- mutate non-ack columns. Simulate by SET ROLE authenticated.
-- ---------------------------------------------------------------------------
DO $t5$
DECLARE
  v_pid UUID;
  v_alert_id UUID;
  v_blocked BOOLEAN := FALSE;
BEGIN
  v_pid := pg_temp.mkmargprod('MA-T5', 'Margin Test 5', 10000, 60.00, 8000);
  PERFORM recompute_recipe_margins_v1();
  SELECT id INTO v_alert_id FROM margin_alerts
   WHERE product_id = v_pid AND acknowledged_at IS NULL LIMIT 1;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', current_setting('ma.admin_uid'), true);

  BEGIN
    UPDATE margin_alerts SET expected_margin_pct = 99.99 WHERE id = v_alert_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := TRUE;
  END;

  RESET ROLE;
  PERFORM set_config('ma.t5', CASE WHEN v_blocked THEN 'blocked' ELSE 'allowed' END, false);
END $t5$;

SELECT is(
  current_setting('ma.t5'),
  'blocked',
  'T5: authenticated role cannot mutate non-ack columns (column-guard fires)'
);

SELECT * FROM finish();

ROLLBACK;
