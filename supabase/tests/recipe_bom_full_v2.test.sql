-- supabase/tests/recipe_bom_full_v2.test.sql
-- Session 17 — Phase 1.D — pgTAP for recipe_bom_full_v2.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- ADR-016 (20260729000002) bumped recipe_bom_full_v1 -> _v2 : the walk now
-- stops at the first intermediate with `track_inventory = true` and returns
-- it as a terminal line valued at its own cost_price, instead of always
-- diving to raw-material leaves. `products.track_inventory` DEFAULTS to
-- true, so sub_1/sub_2/cycle_a/cycle_b below are created with the new
-- explicit `p_track_inventory := FALSE` argument to preserve the "dive to
-- leaves" contract this file exercises (T1-T10). The "stop at a stocked
-- intermediate, valued at its own cost" branch has dedicated coverage in
-- supabase/tests/adr016_descente_semi_finis.test.sql (check #5).
--
-- Coverage matrix :
--   T1  RPC returns rows for a recipe-product.
--   T2  Leaf-only contract : sub-recipe products absent from output.
--   T3  Multi-path aggregation : same leaf reached via 2 paths → single row.
--   T4  Math correctness : qty_per_unit matches expected algebra.
--   T5  p_max_depth=1 stops recursion : sub-recipe appears as leaf.
--   T6  Cycle guard : synthetic cycle via replica-role bypass → output finite.
--   T7  invalid_max_depth (p_max_depth=0) raises P0001.
--   T8  NULL product_id raises P0001.
--   T9  ORDER BY material name : output is alphabetical.
--   T10 Permission gate : non-perm session raises forbidden (P0003).
--
-- Fixture topology :
--   leaf_a (cost 100, 500 stock), leaf_b (cost 50, 200 stock)
--   sub_1  := 0.5 leaf_a + 0.3 leaf_b        (intermediate)
--   sub_2  := 0.4 leaf_a                      (intermediate)
--   top    := 0.1 sub_1 + 0.2 sub_2 + 0.05 leaf_a
--
--   top's leaves (full cascade):
--     leaf_a: 0.1*0.5 + 0.2*0.4 + 0.05 = 0.05 + 0.08 + 0.05 = 0.18
--     leaf_b: 0.1*0.3 = 0.03
--
-- Cycle test: cycle_a uses cycle_b uses cycle_a.
--   Bypass validate_recipe_no_cycle via SET LOCAL session_replication_role='replica'.
--   Guard: output must be finite (no infinite loop).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ---------------------------------------------------------------------------
-- Bootstrap: pick seed admin + category + spoof JWT for permission gate.
-- ---------------------------------------------------------------------------

DO $bootstrap$
DECLARE
  v_admin_uid UUID;
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

-- Helper: create a product in the rolled-back transaction.
-- ADR-016 : p_track_inventory defaults to TRUE (matches products.track_inventory's
-- column default) ; pass FALSE explicitly for an intermediate that must stay
-- diveable to its own leaves under the "stop at stocked" cascade rule.
CREATE OR REPLACE FUNCTION pg_temp.mkprod(
  p_sku TEXT, p_name TEXT, p_unit TEXT,
  p_cost NUMERIC, p_stock NUMERIC DEFAULT 500, p_track_inventory BOOLEAN DEFAULT TRUE
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_cat UUID;
BEGIN
  v_cat := current_setting('breakery.category_id')::uuid;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active, track_inventory)
  VALUES (p_sku, p_name, v_cat, 1000, p_stock, p_unit, p_cost, 'finished', TRUE, p_track_inventory)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- Fixture seed: leaf_a, leaf_b, sub_1, sub_2, top
-- ---------------------------------------------------------------------------
DO $fixture$
DECLARE
  v_leaf_a UUID; v_leaf_b UUID;
  v_sub1   UUID; v_sub2   UUID;
  v_top    UUID;
BEGIN
  v_leaf_a := pg_temp.mkprod('S17-BOM-LA',  'BOM Leaf A',  'pcs', 100, 500);
  v_leaf_b := pg_temp.mkprod('S17-BOM-LB',  'BOM Leaf B',  'pcs', 50,  200);
  -- ADR-016 : sub_1/sub_2 are non-stocked intermediates (p_track_inventory :=
  -- FALSE) so the walk keeps diving to leaf_a/leaf_b (see file header).
  v_sub1   := pg_temp.mkprod('S17-BOM-S1',  'BOM Sub 1',   'pcs', 0,   0, FALSE);
  v_sub2   := pg_temp.mkprod('S17-BOM-S2',  'BOM Sub 2',   'pcs', 0,   0, FALSE);
  v_top    := pg_temp.mkprod('S17-BOM-TOP', 'BOM Top',     'pcs', 0,   0);

  -- sub_1 := 0.5 leaf_a + 0.3 leaf_b
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_sub1, v_leaf_a, 0.5, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_sub1, v_leaf_b, 0.3, 'pcs', TRUE);

  -- sub_2 := 0.4 leaf_a
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_sub2, v_leaf_a, 0.4, 'pcs', TRUE);

  -- top := 0.1 sub_1 + 0.2 sub_2 + 0.05 leaf_a
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_top, v_sub1, 0.1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_top, v_sub2, 0.2, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_top, v_leaf_a, 0.05, 'pcs', TRUE);

  PERFORM set_config('breakery.leaf_a',  v_leaf_a::text, false);
  PERFORM set_config('breakery.leaf_b',  v_leaf_b::text, false);
  PERFORM set_config('breakery.sub1',    v_sub1::text,   false);
  PERFORM set_config('breakery.sub2',    v_sub2::text,   false);
  PERFORM set_config('breakery.top',     v_top::text,    false);
END $fixture$;

-- ===========================================================================
-- T1 — RPC returns rows for a recipe-product.
-- ===========================================================================
SELECT ok(
  (SELECT COUNT(*) > 0 FROM recipe_bom_full_v2(
    current_setting('breakery.top')::uuid, 5
  )),
  'T1: recipe_bom_full_v2 returns at least one row for top product'
);

-- ===========================================================================
-- T2 — Leaf-only contract: sub_1 and sub_2 must NOT appear in output.
-- ===========================================================================
DO $t2$
DECLARE
  v_sub1_found BOOLEAN; v_sub2_found BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 5)
     WHERE material_id = current_setting('breakery.sub1')::uuid
  ) INTO v_sub1_found;
  SELECT EXISTS (
    SELECT 1 FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 5)
     WHERE material_id = current_setting('breakery.sub2')::uuid
  ) INTO v_sub2_found;
  PERFORM set_config('breakery.t2_pass',
    CASE WHEN NOT v_sub1_found AND NOT v_sub2_found
    THEN 'true' ELSE 'false' END, false);
END $t2$;

SELECT ok(
  current_setting('breakery.t2_pass')::boolean,
  'T2: leaf-only contract — sub_1 and sub_2 absent from recipe_bom_full_v2 output'
);

-- ===========================================================================
-- T3 — Multi-path aggregation: leaf_a reached via sub_1, sub_2, and direct →
--      only ONE row for leaf_a.
-- ===========================================================================
SELECT is(
  (SELECT COUNT(*)::INT FROM recipe_bom_full_v2(
    current_setting('breakery.top')::uuid, 5
  ) WHERE material_id = current_setting('breakery.leaf_a')::uuid),
  1,
  'T3: multi-path aggregation — leaf_a appears exactly once (summed across 3 paths)'
);

-- ===========================================================================
-- T4 — Math correctness:
--   leaf_a qty = 0.1*0.5 + 0.2*0.4 + 0.05 = 0.05 + 0.08 + 0.05 = 0.18
--   leaf_b qty = 0.1*0.3 = 0.03
-- ===========================================================================
DO $t4$
DECLARE
  v_qty_a NUMERIC; v_qty_b NUMERIC;
BEGIN
  SELECT qty_per_unit INTO v_qty_a
    FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 5)
   WHERE material_id = current_setting('breakery.leaf_a')::uuid;

  SELECT qty_per_unit INTO v_qty_b
    FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 5)
   WHERE material_id = current_setting('breakery.leaf_b')::uuid;

  PERFORM set_config('breakery.t4_pass',
    CASE WHEN ROUND(v_qty_a::numeric, 10) = 0.18
          AND ROUND(v_qty_b::numeric, 10) = 0.03
    THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t4_dbg',
    format('leaf_a_qty=%s leaf_b_qty=%s', v_qty_a, v_qty_b), false);
END $t4$;

SELECT ok(
  current_setting('breakery.t4_pass')::boolean,
  'T4: math correctness — leaf_a qty=0.18, leaf_b qty=0.03 (3-path cascade)'
);

-- ===========================================================================
-- T5 — p_max_depth=1 stops recursion at depth 1. The leaf filter (NOT EXISTS
--      active children) is applied to DB reality, not walk depth. sub_1 and
--      sub_2 are direct children of top but have their own recipe children →
--      the leaf predicate excludes them even at depth=1. Only leaf_a (which
--      IS a direct child of top AND has no children) appears.
--      This documents the "leaves-only always" invariant regardless of depth.
-- ===========================================================================
DO $t5$
DECLARE
  v_row_count   INT;
  v_leaf_a_found BOOLEAN;
  v_sub1_found  BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_row_count
    FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 1);
  SELECT EXISTS (
    SELECT 1 FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 1)
     WHERE material_id = current_setting('breakery.leaf_a')::uuid
  ) INTO v_leaf_a_found;
  SELECT EXISTS (
    SELECT 1 FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 1)
     WHERE material_id = current_setting('breakery.sub1')::uuid
  ) INTO v_sub1_found;
  PERFORM set_config('breakery.t5_pass',
    CASE WHEN v_leaf_a_found AND NOT v_sub1_found AND v_row_count = 1
    THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t5_dbg',
    format('rows=%s leaf_a=%s sub1=%s', v_row_count, v_leaf_a_found, v_sub1_found), false);
END $t5$;

SELECT ok(
  current_setting('breakery.t5_pass')::boolean,
  'T5: p_max_depth=1 — only true leaves appear (leaf_a direct + real leaf); sub-recipes excluded by leaf predicate'
);

-- ===========================================================================
-- T6 — Cycle guard: insert cycle_a → cycle_b → cycle_a via replica role,
--      then call RPC and verify output is finite (no infinite loop).
-- ===========================================================================
DO $t6$
DECLARE
  v_ca UUID; v_cb UUID;
  v_row_count INT;
BEGIN
  -- ADR-016 : both non-stocked (p_track_inventory := FALSE) so the walk
  -- actually attempts to recurse past them — otherwise `is_stocked = TRUE`
  -- (the column default) would stop the walk at depth 1 and the
  -- NOT(material_id = ANY(path)) guard below would never be exercised.
  v_ca := pg_temp.mkprod('S17-BOM-CA', 'BOM Cycle A', 'pcs', 100, 0, FALSE);
  v_cb := pg_temp.mkprod('S17-BOM-CB', 'BOM Cycle B', 'pcs', 100, 0, FALSE);

  -- Bypass the anti-cycle trigger temporarily to seed the cyclic edge.
  SET LOCAL session_replication_role = 'replica';

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_ca, v_cb, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_cb, v_ca, 1, 'pcs', TRUE);

  -- Restore normal trigger behaviour for the RPC call.
  SET LOCAL session_replication_role = 'origin';

  -- The cycle guard (NOT material_id = ANY(path)) must terminate the walk.
  SELECT COUNT(*) INTO v_row_count
    FROM recipe_bom_full_v2(v_ca, 5);

  -- With a perfect cycle and no true leaves, output should be 0 rows (no leaves found).
  PERFORM set_config('breakery.t6_pass', 'true', false);
  PERFORM set_config('breakery.t6_rows', v_row_count::text, false);
EXCEPTION WHEN OTHERS THEN
  -- Any error (including infinite-loop OOM) → fail
  PERFORM set_config('breakery.t6_pass', 'false', false);
  PERFORM set_config('breakery.t6_err', SQLERRM, false);
END $t6$;

SELECT ok(
  current_setting('breakery.t6_pass')::boolean,
  'T6: cycle guard — cyclic recipe graph terminates finitely (path[] stops recursion)'
);

-- ===========================================================================
-- T7 — invalid_max_depth raises P0001.
-- ===========================================================================
SELECT throws_ok(
  format($q$SELECT * FROM recipe_bom_full_v2(%L::uuid, 0)$q$,
         current_setting('breakery.top')),
  'P0001',
  'invalid_max_depth',
  'T7: p_max_depth=0 raises P0001 invalid_max_depth'
);

-- ===========================================================================
-- T8 — NULL product_id raises P0001.
-- ===========================================================================
SELECT throws_ok(
  $$SELECT * FROM recipe_bom_full_v2(NULL::uuid, 5)$$,
  'P0001',
  'product_id_required',
  'T8: NULL product_id raises P0001 product_id_required'
);

-- ===========================================================================
-- T9 — ORDER BY material name: output rows are in ascending alphabetical order.
-- ===========================================================================
DO $t9$
DECLARE
  v_names TEXT[];
  v_sorted TEXT[];
BEGIN
  SELECT ARRAY_AGG(material_name ORDER BY ordinality)
    INTO v_names
    FROM recipe_bom_full_v2(current_setting('breakery.top')::uuid, 5)
         WITH ORDINALITY;

  v_sorted := ARRAY(SELECT unnest(v_names) ORDER BY 1);

  PERFORM set_config('breakery.t9_pass',
    CASE WHEN v_names = v_sorted THEN 'true' ELSE 'false' END, false);
END $t9$;

SELECT ok(
  current_setting('breakery.t9_pass')::boolean,
  'T9: output rows are sorted by material_name ascending (ORDER BY p.name)'
);

-- ===========================================================================
-- T10 — Permission gate: non-perm session raises forbidden (P0003).
-- ===========================================================================
DO $t10_setup$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
END $t10_setup$;

SELECT throws_ok(
  format($q$SELECT * FROM recipe_bom_full_v2(%L::uuid, 5)$q$,
         current_setting('breakery.top')),
  'P0003',
  'forbidden',
  'T10: non-perm session raises forbidden (P0003)'
);

-- Restore admin JWT for clean teardown.
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    current_setting('breakery.admin_uid'), false);
END $$;

SELECT * FROM finish();
ROLLBACK;
