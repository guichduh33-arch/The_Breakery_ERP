-- supabase/tests/recipe_cost_history_v1.test.sql
-- Session 18 — Phase 1.A — pgTAP for recipe_cost_history_v1.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- Coverage matrix :
--   T1  Overview returns 1 row for test product with history in window.
--   T2  Overview baseline_cost = latest version ≤ p_from.
--   T3  Overview cost_per_unit = latest version ≤ p_to.
--   T4  Overview delta_pct math : round(((cur-base)/base)*100, 2).
--   T5  Overview change_count = COUNT versions in window.
--   T6  Drill-down returns versions for given product_id in window.
--   T7  Drill-down ORDER BY version_number ASC.
--   T8  Empty window returns 0 rows.
--   T9  p_from > p_to raises P0001 invalid_date_range.
--   T10 Drill-down on unknown product_id returns 0 rows (no error).
--   T11 Permission gate: random UID (no financial.read) raises P0003 forbidden.
--   T12 Legacy bare-array snapshot rows are excluded from output.
--
-- Fixture topology:
--   prod_a (seeded product with 3 recipe_versions at known dates)
--   Version 1 : created 2025-01-01, cost = 100.00  (baseline, before p_from)
--   Version 2 : created 2025-02-01, cost = 120.00  (inside window)
--   Version 3 : created 2025-03-01, cost = 150.00  (inside window, current)
--
--   Window : p_from = '2025-01-15', p_to = '2025-03-31'
--   baseline_cost = 100.00  (latest ≤ 2025-01-15 = v1)
--   cost_per_unit = 150.00  (latest ≤ 2025-03-31 = v3)
--   change_count  = 2       (v2 + v3 fall in [p_from, p_to])
--   delta_pct     = round(((150-100)/100)*100, 2) = 50.00

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

-- ---------------------------------------------------------------------------
-- Bootstrap: pick seed admin + category + spoof JWT for permission gate.
-- ---------------------------------------------------------------------------

DO $bootstrap$
DECLARE
  v_admin_uid   UUID;
  v_category_id UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid
    FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
  PERFORM set_config('breakery.admin_uid', v_admin_uid::text, false);

  SELECT id INTO v_category_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'No active category — seeds incomplete';
  END IF;
  PERFORM set_config('breakery.category_id', v_category_id::text, false);
END $bootstrap$;

-- ---------------------------------------------------------------------------
-- Fixture: prod_a + 3 recipe_versions at known timestamps.
-- Direct INSERT into recipe_versions is safe (trigger is on `recipes`, not here).
-- ---------------------------------------------------------------------------

DO $fixture$
DECLARE
  v_prod_a UUID := gen_random_uuid();
  v_cat    UUID := current_setting('breakery.category_id')::uuid;
BEGIN
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (v_prod_a, 'S18-RCH-PA', 'RCH Prod A', v_cat, 5000, 100,
          'pcs', 100.00, 'finished', TRUE);

  -- Version 1 : before window (baseline anchor)
  INSERT INTO recipe_versions (product_id, version_number, snapshot, change_note, created_at)
  VALUES (
    v_prod_a, 1,
    jsonb_build_object(
      'product_cost_at_version', 100.00,
      'items', jsonb_build_array(
        jsonb_build_object('material_id', gen_random_uuid(), 'material_cost_price', 100.00)
      )
    ),
    'Initial recipe',
    '2025-01-01 10:00:00+00'
  );

  -- Version 2 : inside window
  INSERT INTO recipe_versions (product_id, version_number, snapshot, change_note, created_at)
  VALUES (
    v_prod_a, 2,
    jsonb_build_object(
      'product_cost_at_version', 120.00,
      'items', jsonb_build_array(
        jsonb_build_object('material_id', gen_random_uuid(), 'material_cost_price', 120.00)
      )
    ),
    'Cost adjustment Feb',
    '2025-02-01 10:00:00+00'
  );

  -- Version 3 : inside window (latest)
  INSERT INTO recipe_versions (product_id, version_number, snapshot, change_note, created_at)
  VALUES (
    v_prod_a, 3,
    jsonb_build_object(
      'product_cost_at_version', 150.00,
      'items', jsonb_build_array(
        jsonb_build_object('material_id', gen_random_uuid(), 'material_cost_price', 150.00)
      )
    ),
    'Cost adjustment Mar',
    '2025-03-01 10:00:00+00'
  );

  -- Legacy bare-array row (no 'items' key) — must be excluded from all output.
  INSERT INTO recipe_versions (product_id, version_number, snapshot, change_note, created_at)
  VALUES (
    v_prod_a, 99,
    '[{"material_id":"legacy"}]'::jsonb,
    'Legacy row',
    '2025-02-15 10:00:00+00'
  );

  PERFORM set_config('breakery.prod_a',     v_prod_a::text, false);
  PERFORM set_config('breakery.p_from',     '2025-01-15',   false);
  PERFORM set_config('breakery.p_to',       '2025-03-31',   false);
END $fixture$;

-- ===========================================================================
-- T1 — Overview returns exactly 1 row for the test product with history
--      in the window.
-- ===========================================================================
SELECT is(
  (SELECT COUNT(*)::INT
     FROM recipe_cost_history_v1(
       current_setting('breakery.p_from')::DATE,
       current_setting('breakery.p_to')::DATE,
       NULL
     )
    WHERE product_id = current_setting('breakery.prod_a')::UUID),
  1,
  'T1: overview returns exactly 1 row for test product with history in window'
);

-- ===========================================================================
-- T2 — Overview baseline_cost = latest version ≤ p_from (= v1, cost 100.00).
-- ===========================================================================
DO $t2$
DECLARE v_baseline NUMERIC;
BEGIN
  SELECT baseline_cost INTO v_baseline
    FROM recipe_cost_history_v1(
      current_setting('breakery.p_from')::DATE,
      current_setting('breakery.p_to')::DATE,
      NULL
    )
   WHERE product_id = current_setting('breakery.prod_a')::UUID;
  PERFORM set_config('breakery.t2_pass',
    CASE WHEN v_baseline = 100.00 THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t2_dbg', format('baseline=%s', v_baseline), false);
END $t2$;

SELECT ok(
  current_setting('breakery.t2_pass')::boolean,
  'T2: overview baseline_cost = 100.00 (latest version ≤ p_from)'
);

-- ===========================================================================
-- T3 — Overview cost_per_unit = latest version ≤ p_to (= v3, cost 150.00).
-- ===========================================================================
DO $t3$
DECLARE v_current NUMERIC;
BEGIN
  SELECT cost_per_unit INTO v_current
    FROM recipe_cost_history_v1(
      current_setting('breakery.p_from')::DATE,
      current_setting('breakery.p_to')::DATE,
      NULL
    )
   WHERE product_id = current_setting('breakery.prod_a')::UUID;
  PERFORM set_config('breakery.t3_pass',
    CASE WHEN v_current = 150.00 THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t3_dbg', format('current=%s', v_current), false);
END $t3$;

SELECT ok(
  current_setting('breakery.t3_pass')::boolean,
  'T3: overview cost_per_unit = 150.00 (latest version ≤ p_to)'
);

-- ===========================================================================
-- T4 — Overview delta_pct = round(((150-100)/100)*100, 2) = 50.00.
-- ===========================================================================
DO $t4$
DECLARE v_delta NUMERIC;
BEGIN
  SELECT delta_pct INTO v_delta
    FROM recipe_cost_history_v1(
      current_setting('breakery.p_from')::DATE,
      current_setting('breakery.p_to')::DATE,
      NULL
    )
   WHERE product_id = current_setting('breakery.prod_a')::UUID;
  PERFORM set_config('breakery.t4_pass',
    CASE WHEN v_delta = 50.00 THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t4_dbg', format('delta_pct=%s', v_delta), false);
END $t4$;

SELECT ok(
  current_setting('breakery.t4_pass')::boolean,
  'T4: overview delta_pct = 50.00 — round(((150-100)/100)*100, 2)'
);

-- ===========================================================================
-- T5 — Overview change_count = 2 (v2 on 2025-02-01, v3 on 2025-03-01 are
--      in the window [2025-01-15, 2025-03-31]; legacy bare-array excluded).
-- ===========================================================================
DO $t5$
DECLARE v_cnt INT;
BEGIN
  SELECT change_count INTO v_cnt
    FROM recipe_cost_history_v1(
      current_setting('breakery.p_from')::DATE,
      current_setting('breakery.p_to')::DATE,
      NULL
    )
   WHERE product_id = current_setting('breakery.prod_a')::UUID;
  PERFORM set_config('breakery.t5_pass',
    CASE WHEN v_cnt = 2 THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t5_dbg', format('change_count=%s', v_cnt), false);
END $t5$;

SELECT ok(
  current_setting('breakery.t5_pass')::boolean,
  'T5: overview change_count = 2 (v2 + v3 in window; legacy excluded)'
);

-- ===========================================================================
-- T6 — Drill-down returns versions for the given product_id in window.
--      v2 (2025-02-01) and v3 (2025-03-01) are in window → expect 2 rows.
-- ===========================================================================
SELECT is(
  (SELECT COUNT(*)::INT
     FROM recipe_cost_history_v1(
       current_setting('breakery.p_from')::DATE,
       current_setting('breakery.p_to')::DATE,
       current_setting('breakery.prod_a')::UUID
     )),
  2,
  'T6: drill-down returns 2 versions in window (v2 + v3; v1 before window, legacy excluded)'
);

-- ===========================================================================
-- T7 — Drill-down ORDER BY version_number ASC: first row = v2 (120), second = v3 (150).
-- ===========================================================================
DO $t7$
DECLARE
  v_first_ver  INT;
  v_second_ver INT;
BEGIN
  SELECT version_number INTO v_first_ver
    FROM recipe_cost_history_v1(
      current_setting('breakery.p_from')::DATE,
      current_setting('breakery.p_to')::DATE,
      current_setting('breakery.prod_a')::UUID
    )
  ORDER BY version_number ASC
  LIMIT 1;

  SELECT version_number INTO v_second_ver
    FROM recipe_cost_history_v1(
      current_setting('breakery.p_from')::DATE,
      current_setting('breakery.p_to')::DATE,
      current_setting('breakery.prod_a')::UUID
    )
  ORDER BY version_number ASC
  OFFSET 1 LIMIT 1;

  PERFORM set_config('breakery.t7_pass',
    CASE WHEN v_first_ver = 2 AND v_second_ver = 3
    THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t7_dbg',
    format('first_ver=%s second_ver=%s', v_first_ver, v_second_ver), false);
END $t7$;

SELECT ok(
  current_setting('breakery.t7_pass')::boolean,
  'T7: drill-down ORDER BY version_number ASC (first=v2, second=v3)'
);

-- ===========================================================================
-- T8 — Empty window (p_from and p_to before all versions) returns 0 rows.
-- ===========================================================================
SELECT is(
  (SELECT COUNT(*)::INT
     FROM recipe_cost_history_v1(
       '2020-01-01'::DATE,
       '2020-12-31'::DATE,
       NULL
     )
    WHERE product_id = current_setting('breakery.prod_a')::UUID),
  0,
  'T8: empty window (before all versions) returns 0 rows for test product'
);

-- ===========================================================================
-- T9 — p_from > p_to raises P0001 invalid_date_range.
-- ===========================================================================
SELECT throws_ok(
  $$SELECT * FROM recipe_cost_history_v1('2025-12-31'::DATE, '2025-01-01'::DATE, NULL)$$,
  'P0001',
  'invalid_date_range',
  'T9: p_from > p_to raises P0001 invalid_date_range'
);

-- ===========================================================================
-- T10 — Drill-down with unknown product_id returns 0 rows (no error).
-- ===========================================================================
SELECT is(
  (SELECT COUNT(*)::INT
     FROM recipe_cost_history_v1(
       current_setting('breakery.p_from')::DATE,
       current_setting('breakery.p_to')::DATE,
       '00000000-0000-0000-0000-000000000000'::UUID
     )),
  0,
  'T10: drill-down with unknown product_id returns 0 rows (no error)'
);

-- ===========================================================================
-- T11 — Permission gate: random UID (no financial.read) raises P0003 forbidden.
-- ===========================================================================
DO $t11_setup$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
END $t11_setup$;

SELECT throws_ok(
  $$SELECT * FROM recipe_cost_history_v1('2025-01-15'::DATE, '2025-03-31'::DATE, NULL)$$,
  'P0003',
  'forbidden',
  'T11: non-perm session raises forbidden (P0003)'
);

-- Restore admin JWT for T12.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    current_setting('breakery.admin_uid'), false);
END $$;

-- ===========================================================================
-- T12 — Legacy bare-array snapshot rows (version_number=99) are excluded.
--       Drill-down for prod_a in a wide window should NOT include v99.
--       We verify version_number 99 is absent from drill-down output.
-- ===========================================================================
DO $t12$
DECLARE v_legacy_found BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM recipe_cost_history_v1(
        '2000-01-01'::DATE,
        '2099-12-31'::DATE,
        current_setting('breakery.prod_a')::UUID
      )
     WHERE version_number = 99
  ) INTO v_legacy_found;
  PERFORM set_config('breakery.t12_pass',
    CASE WHEN NOT v_legacy_found THEN 'true' ELSE 'false' END, false);
END $t12$;

SELECT ok(
  current_setting('breakery.t12_pass')::boolean,
  'T12: legacy bare-array snapshot (version_number=99) excluded from drill-down output'
);

SELECT * FROM finish();
ROLLBACK;
