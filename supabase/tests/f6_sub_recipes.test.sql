-- supabase/tests/f6_sub_recipes.test.sql
-- Session 15 / Phase 1.C — F6 sub-recipes : pgTAP acceptance suite.
--
-- Covers the 7 migrations 20260519000001..000010 (anti-cycle trigger,
-- calculate_recipe_cost_v1, recipe_versions snapshot, backfill,
-- production_records.recipe_version_id, record_production_v1 cascade,
-- production_records.materials_breakdown) PLUS the Phase 2.A yield-aware
-- extension (migrations 20260519000040..000044).
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- KNOWN PHASE 1.A QUIRK : record_production_v1 issues `CREATE TEMP TABLE
-- _bom_flatten ... ON COMMIT DROP` and `_leaf_consumption` internally. When
-- the function is invoked more than once within the same SQL transaction
-- (as happens in this pgTAP suite under its BEGIN..ROLLBACK envelope), the
-- second invocation collides on the already-existing temp table.
-- In production this never fires because each PostgREST RPC call is its
-- own transaction. To make the pgTAP suite self-contained we explicitly
-- `DROP TABLE IF EXISTS pg_temp._bom_flatten, pg_temp._leaf_consumption`
-- between successive record_production_v1 invocations. This is documented
-- as a follow-up deviation pack `D-S15-1A-TEMPTBL-01` in the session 15
-- closeout notes (consider migrating the function to TRUNCATE-on-reuse
-- semantics or randomized table names).
--
-- KNOWN UPSTREAM (Session 13) BEHAVIOUR : record_stock_movement_v1 (the
-- shared primitive) hardcodes `reference_type='admin_action'` and never
-- populates `reference_id`. Therefore production-related stock_movements
-- are NOT findable via `WHERE reference_type='production' AND reference_id=
-- production_id`. They ARE findable via the `metadata->>'production_id'`
-- JSONB tag injected by record_production_v1. This pgTAP suite uses the
-- metadata path. Tracked as deviation pack `D-S13-MVTREF-01`.
--
-- Coverage matrix :
--   T1  validate_recipe_no_cycle : direct cycle A→B + B→A rejected (P0001).
--   T2  validate_recipe_no_cycle : indirect cycle A→B→C→A rejected (P0001).
--   T3  recipes self-loop A→A rejected (table CHECK constraint).
--   T4  depth 5 chain allowed (no error).
--   T5  depth 6 chain rejected with recipe_depth_exceeded.
--   T6  soft-deleted row does NOT trip the cycle trigger.
--   T7  calculate_recipe_cost_v1 : flat recipe → cost_per_unit + breakdown len.
--   T8  calculate_recipe_cost_v1 : 2-level cascade → depth>=2, sub_breakdown.
--   T9  calculate_recipe_cost_v1 STABLE : same input twice → same output.
--   T10 calculate_recipe_cost_v1 : non-perm role → forbidden (P0003).
--   T11 recipe_versions snapshot trigger fires on INSERT (version_number=1).
--   T12 recipe_versions trigger AFTER UPDATE + soft-delete (monotonic).
--   T13 Backfill : every product with active recipes has a recipe_versions row.
--   T14 production_records.recipe_version_id resolved to latest snapshot.
--   T15 record_production_v1 cascade : 2-level recipe → leaf-only out movements.
--   T16 record_production_v1 recurse=FALSE falls back to flat behaviour.
--   T17 materials_breakdown captures is_intermediate flag for intermediates.
--   T18 record_production_v1 aggregates same-leaf consumption across paths.
--   T19 record_production_v1 idempotency replay returns same production_id.
--   T20 record_production_v1 depth>5 raises recipe_depth_exceeded.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(20);

-- ---------------------------------------------------------------------------
-- Bootstrap : pick the seed admin, resolve a section, ensure category exists.
-- ---------------------------------------------------------------------------

DO $bootstrap$
DECLARE
  v_admin_uid     UUID;
  v_admin_profile UUID;
  v_section_id    UUID;
  v_category_id   UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found — apply session 13 seeds first';
  END IF;
  PERFORM set_config('breakery.admin_uid', v_admin_uid::text, false);

  SELECT id INTO v_admin_profile FROM user_profiles WHERE auth_user_id = v_admin_uid;
  PERFORM set_config('breakery.admin_profile', v_admin_profile::text, false);

  SELECT id INTO v_section_id FROM sections
    WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  IF v_section_id IS NULL THEN
    RAISE EXCEPTION 'No active section found — seeds incomplete';
  END IF;
  PERFORM set_config('breakery.section_id', v_section_id::text, false);

  SELECT id INTO v_category_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'No active category found — seeds incomplete';
  END IF;
  PERFORM set_config('breakery.category_id', v_category_id::text, false);

  -- Spoof JWT.sub for the duration of this transaction (SECURITY DEFINER RPCs
  -- read auth.uid() which reads request.jwt.claim.sub).
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
END $bootstrap$;

-- Helper : create a product. The `slug` column does not exist on products in
-- the V3 dev schema ; sku acts as the natural key.
CREATE OR REPLACE FUNCTION pg_temp.mkprod(p_sku TEXT, p_name TEXT, p_unit TEXT, p_cost DECIMAL, p_stock DECIMAL DEFAULT 1000)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_cat UUID;
BEGIN
  v_cat := current_setting('breakery.category_id')::uuid;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (p_sku, p_name, v_cat, 100, p_stock, p_unit, p_cost, 'finished', TRUE)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ===========================================================================
-- Fixtures : distinct SKUs / UUIDs per test block, scoped to BEGIN..ROLLBACK.
-- ===========================================================================

DO $seed$
DECLARE
  v_a UUID; v_b UUID; v_c UUID;
BEGIN
  v_a := pg_temp.mkprod('S15-T1-A', 'S15 T1 product A', 'pcs', 100);
  v_b := pg_temp.mkprod('S15-T1-B', 'S15 T1 product B', 'pcs', 100);
  PERFORM set_config('breakery.t1_a', v_a::text, false);
  PERFORM set_config('breakery.t1_b', v_b::text, false);

  v_a := pg_temp.mkprod('S15-T2-A', 'S15 T2 A', 'pcs', 100);
  v_b := pg_temp.mkprod('S15-T2-B', 'S15 T2 B', 'pcs', 100);
  v_c := pg_temp.mkprod('S15-T2-C', 'S15 T2 C', 'pcs', 100);
  PERFORM set_config('breakery.t2_a', v_a::text, false);
  PERFORM set_config('breakery.t2_b', v_b::text, false);
  PERFORM set_config('breakery.t2_c', v_c::text, false);

  v_a := pg_temp.mkprod('S15-T3-A', 'S15 T3 A', 'pcs', 100);
  PERFORM set_config('breakery.t3_a', v_a::text, false);
END $seed$;

-- ===========================================================================
-- T1 — Direct cycle rejection (A→B then B→A → P0001)
-- ===========================================================================
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
SELECT current_setting('breakery.t1_a')::uuid,
       current_setting('breakery.t1_b')::uuid,
       1, 'pcs', TRUE;

SELECT throws_ok(
  format($q$INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
           VALUES (%L::uuid, %L::uuid, 1, 'pcs', TRUE)$q$,
         current_setting('breakery.t1_b'),
         current_setting('breakery.t1_a')),
  'P0001',
  'recipe_cycle_detected',
  'T1: direct cycle A->B + B->A rejected with P0001 recipe_cycle_detected'
);

-- ===========================================================================
-- T2 — Indirect cycle A→B→C→A rejected
-- ===========================================================================
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
SELECT current_setting('breakery.t2_a')::uuid,
       current_setting('breakery.t2_b')::uuid,
       1, 'pcs', TRUE;
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
SELECT current_setting('breakery.t2_b')::uuid,
       current_setting('breakery.t2_c')::uuid,
       1, 'pcs', TRUE;

SELECT throws_ok(
  format($q$INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
           VALUES (%L::uuid, %L::uuid, 1, 'pcs', TRUE)$q$,
         current_setting('breakery.t2_c'),
         current_setting('breakery.t2_a')),
  'P0001',
  'recipe_cycle_detected',
  'T2: indirect cycle A->B->C->A rejected with P0001 recipe_cycle_detected'
);

-- ===========================================================================
-- T3 — Self-loop A→A rejected (table CHECK constraint precedes the trigger)
-- ===========================================================================
SELECT throws_ok(
  format($q$INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
           VALUES (%L::uuid, %L::uuid, 1, 'pcs', TRUE)$q$,
         current_setting('breakery.t3_a'),
         current_setting('breakery.t3_a')),
  NULL, NULL,
  'T3: self-loop A->A rejected (recipes_product_material_distinct CHECK)'
);

-- ===========================================================================
-- T4 — Depth-5 chain accepted
-- ===========================================================================
DO $t4_seed$
DECLARE
  ids UUID[];
  i INT;
BEGIN
  ids := ARRAY[]::UUID[];
  FOR i IN 1..6 LOOP
    ids := ids || pg_temp.mkprod('S15-T4-P' || i, 'S15 T4 P' || i, 'pcs', 100);
  END LOOP;
  PERFORM set_config('breakery.t4_ids', array_to_string(ids, ','), false);

  FOR i IN 1..5 LOOP
    INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (ids[i], ids[i+1], 1, 'pcs', TRUE);
  END LOOP;
  PERFORM set_config('breakery.t4_pass', 'true', false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('breakery.t4_pass', 'false', false);
END $t4_seed$;

SELECT ok(current_setting('breakery.t4_pass')::boolean,
  'T4: depth-5 chain of recipes accepted (no recipe_depth_exceeded raised)');

-- ===========================================================================
-- T5 — Depth-6 chain rejected.
--   Build a fresh 6-edge chain P2→P3→…→P8 (built bottom-up so each
--   intermediate INSERT sees only a small descendant walk that fits within
--   the trigger's max=5). Then INSERT a TOP→P2 row : the trigger walker
--   starts from P2 and reaches depth 6 (>max) → raises recipe_depth_exceeded.
-- ===========================================================================
DO $t5_seed$
DECLARE
  v_top UUID; v_p2 UUID; v_p3 UUID; v_p4 UUID; v_p5 UUID; v_p6 UUID; v_p7 UUID; v_p8 UUID;
BEGIN
  v_top := pg_temp.mkprod('S15-T5-TOP', 'S15 T5 TOP', 'pcs', 100);
  v_p2  := pg_temp.mkprod('S15-T5-P2',  'S15 T5 P2',  'pcs', 100);
  v_p3  := pg_temp.mkprod('S15-T5-P3',  'S15 T5 P3',  'pcs', 100);
  v_p4  := pg_temp.mkprod('S15-T5-P4',  'S15 T5 P4',  'pcs', 100);
  v_p5  := pg_temp.mkprod('S15-T5-P5',  'S15 T5 P5',  'pcs', 100);
  v_p6  := pg_temp.mkprod('S15-T5-P6',  'S15 T5 P6',  'pcs', 100);
  v_p7  := pg_temp.mkprod('S15-T5-P7',  'S15 T5 P7',  'pcs', 100);
  v_p8  := pg_temp.mkprod('S15-T5-P8',  'S15 T5 P8',  'pcs', 100);

  -- Build 6-edge chain bottom-up : P7→P8, P6→P7, ..., P2→P3.
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p7, v_p8, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p6, v_p7, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p5, v_p6, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p4, v_p5, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p3, v_p4, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p2, v_p3, 1, 'pcs', TRUE);

  PERFORM set_config('breakery.t5_top', v_top::text, false);
  PERFORM set_config('breakery.t5_p2', v_p2::text, false);
END $t5_seed$;

-- INSERT TOP→P2 — trigger walks descendants of P2 → reaches depth 6 → ERROR.
SELECT throws_ok(
  format($q$INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
           VALUES (%L::uuid, %L::uuid, 1, 'pcs', TRUE)$q$,
         current_setting('breakery.t5_top'),
         current_setting('breakery.t5_p2')),
  'P0001',
  'recipe_depth_exceeded',
  'T5: depth-6 chain triggers recipe_depth_exceeded on new TOP->P2 INSERT'
);

-- ===========================================================================
-- T6 — Soft-deleted row does NOT trip cycle trigger
-- ===========================================================================
DO $t6_seed$
DECLARE
  v_a UUID; v_b UUID;
BEGIN
  v_a := pg_temp.mkprod('S15-T6-A', 'S15 T6 A', 'pcs', 100);
  v_b := pg_temp.mkprod('S15-T6-B', 'S15 T6 B', 'pcs', 100);

  -- Active edge a→b.
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_a, v_b, 1, 'pcs', TRUE);

  -- Soft-delete it (UPDATE) — trigger must NOT reject this.
  UPDATE recipes SET is_active = FALSE, deleted_at = now()
    WHERE product_id = v_a AND material_id = v_b;

  -- b→a should be accepted (active a→b no longer exists).
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_b, v_a, 1, 'pcs', TRUE);

  PERFORM set_config('breakery.t6_pass', 'true', false);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('breakery.t6_pass', 'false', false);
  PERFORM set_config('breakery.t6_err', SQLERRM, false);
END $t6_seed$;

SELECT ok(
  current_setting('breakery.t6_pass')::boolean,
  'T6: soft-deleted A->B row does not trip the cycle trigger on subsequent B->A insert'
);

-- ===========================================================================
-- T7 — calculate_recipe_cost_v1 : flat recipe → cost=1600
-- ===========================================================================
DO $t7_seed$
DECLARE
  v_finished UUID; v_m1 UUID; v_m2 UUID; v_result JSONB;
BEGIN
  v_finished := pg_temp.mkprod('S15-T7-FIN', 'S15 T7 finished', 'pcs', 0);
  v_m1       := pg_temp.mkprod('S15-T7-M1',  'S15 T7 mat1',     'pcs', 200);
  v_m2       := pg_temp.mkprod('S15-T7-M2',  'S15 T7 mat2',     'pcs', 500);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_finished, v_m1, 3, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_finished, v_m2, 2, 'pcs', TRUE);

  v_result := calculate_recipe_cost_v1(v_finished, 5);
  PERFORM set_config('breakery.t7_cost', (v_result->>'cost_per_unit'), false);
  PERFORM set_config('breakery.t7_breakdown_len',
                     jsonb_array_length(v_result->'breakdown')::text, false);
  PERFORM set_config('breakery.t7_has_cycle', (v_result->>'has_cycle'), false);
END $t7_seed$;

SELECT ok(
  (current_setting('breakery.t7_cost')::numeric = 1600)
  AND (current_setting('breakery.t7_breakdown_len')::int = 2)
  AND (current_setting('breakery.t7_has_cycle')::boolean = FALSE),
  'T7: calculate_recipe_cost_v1 flat recipe -> cost=1600, 2 breakdown lines, no cycle'
);

-- ===========================================================================
-- T8 — calculate_recipe_cost_v1 : 2-level cascade
--   FIN := 1 INT + 1 LX (cost 300)
--   INT := 2 LY (cost 100 each → INT unit cost = 200)
--   Expected FIN unit cost = 1*200 + 1*300 = 500.
-- ===========================================================================
DO $t8_seed$
DECLARE
  v_fin UUID; v_int UUID; v_lx UUID; v_ly UUID; v_result JSONB; v_subline JSONB;
BEGIN
  v_ly := pg_temp.mkprod('S15-T8-LY', 'S15 T8 leaf Y',   'pcs', 100);
  v_lx := pg_temp.mkprod('S15-T8-LX', 'S15 T8 leaf X',   'pcs', 300);
  v_int:= pg_temp.mkprod('S15-T8-INT','S15 T8 intermed', 'pcs', 0);
  v_fin:= pg_temp.mkprod('S15-T8-FIN','S15 T8 finished', 'pcs', 0);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_int, v_ly, 2, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_int, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_lx, 1, 'pcs', TRUE);

  v_result := calculate_recipe_cost_v1(v_fin, 5);

  SELECT line INTO v_subline
    FROM jsonb_array_elements(v_result->'breakdown') AS line
   WHERE (line->>'is_recipe')::boolean = TRUE
   LIMIT 1;

  PERFORM set_config('breakery.t8_cost', (v_result->>'cost_per_unit'), false);
  PERFORM set_config('breakery.t8_depth', (v_result->>'depth_reached'), false);
  PERFORM set_config('breakery.t8_has_sub',
    CASE WHEN v_subline ? 'sub_breakdown' THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t8_fin', v_fin::text, false);
END $t8_seed$;

SELECT ok(
  (current_setting('breakery.t8_cost')::numeric = 500)
  AND (current_setting('breakery.t8_depth')::int >= 2)
  AND current_setting('breakery.t8_has_sub')::boolean,
  'T8: calculate_recipe_cost_v1 2-level cascade -> cost=500, depth>=2, sub_breakdown present'
);

-- ===========================================================================
-- T9 — calculate_recipe_cost_v1 STABLE : same input → same output
-- ===========================================================================
SELECT is(
  calculate_recipe_cost_v1(current_setting('breakery.t8_fin')::uuid, 5),
  calculate_recipe_cost_v1(current_setting('breakery.t8_fin')::uuid, 5),
  'T9: calculate_recipe_cost_v1 STABLE -- same input twice -> identical JSONB output'
);

-- ===========================================================================
-- T10 — non-perm session → forbidden P0003
-- ===========================================================================
DO $t10$
DECLARE v_fake_uid UUID := gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_fake_uid::text, true);
END $t10$;

SELECT throws_ok(
  format($q$SELECT calculate_recipe_cost_v1(%L::uuid, 5)$q$,
         current_setting('breakery.t8_fin')),
  'P0003',
  'forbidden',
  'T10: calculate_recipe_cost_v1 from non-perm session raises forbidden (P0003)'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub',
    current_setting('breakery.admin_uid'), false);
END $$;

-- ===========================================================================
-- T11 — recipe_versions snapshot on INSERT (version_number=1)
-- ===========================================================================
DO $t11_seed$
DECLARE
  v_p UUID; v_m UUID; v_cnt INT; v_vn INT; v_snap JSONB;
BEGIN
  v_p := pg_temp.mkprod('S15-T11-P', 'S15 T11 product', 'pcs', 0);
  v_m := pg_temp.mkprod('S15-T11-M', 'S15 T11 material', 'pcs', 100);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_p, v_m, 1, 'pcs', TRUE);

  SELECT COUNT(*), MAX(version_number) INTO v_cnt, v_vn
    FROM recipe_versions WHERE product_id = v_p;
  SELECT snapshot INTO v_snap FROM recipe_versions
    WHERE product_id = v_p ORDER BY version_number DESC LIMIT 1;

  PERFORM set_config('breakery.t11_p', v_p::text, false);
  PERFORM set_config('breakery.t11_m', v_m::text, false);
  PERFORM set_config('breakery.t11_pass',
    CASE WHEN v_cnt = 1 AND v_vn = 1 AND jsonb_array_length(v_snap) = 1
    THEN 'true' ELSE 'false' END, false);
END $t11_seed$;

SELECT ok(current_setting('breakery.t11_pass')::boolean,
  'T11: recipe_versions snapshot on INSERT -> version_number=1, snapshot array has 1 entry');

-- ===========================================================================
-- T12 — UPDATE + soft-delete bump version_number monotonically
-- ===========================================================================
DO $t12_seed$
DECLARE
  v_p UUID := current_setting('breakery.t11_p')::uuid;
  v_m UUID := current_setting('breakery.t11_m')::uuid;
  v_after_update INT;
  v_after_delete INT;
BEGIN
  UPDATE recipes SET quantity = 2
    WHERE product_id = v_p AND material_id = v_m AND is_active = TRUE;
  SELECT MAX(version_number) INTO v_after_update FROM recipe_versions
    WHERE product_id = v_p;

  UPDATE recipes SET is_active = FALSE, deleted_at = now()
    WHERE product_id = v_p AND material_id = v_m;
  SELECT MAX(version_number) INTO v_after_delete FROM recipe_versions
    WHERE product_id = v_p;

  PERFORM set_config('breakery.t12_pass',
    CASE WHEN v_after_update = 2 AND v_after_delete = 3
    THEN 'true' ELSE 'false' END, false);
END $t12_seed$;

SELECT ok(current_setting('breakery.t12_pass')::boolean,
  'T12: recipe_versions trigger AFTER UPDATE + AFTER soft-delete -> monotonic version 1->2->3');

-- ===========================================================================
-- T13 — Backfill : every product with active recipes has a recipe_versions row
-- ===========================================================================
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM recipes r
     WHERE r.is_active = TRUE AND r.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM recipe_versions rv WHERE rv.product_id = r.product_id
       )
  ),
  'T13: backfill_session_15 -- every active-recipe product has at least one recipe_versions row'
);

-- ===========================================================================
-- T14 — record_production_v1 resolves recipe_version_id
--   First record_production_v1 invocation. NO prior invocation in this
--   transaction → no DROP needed before.
-- ===========================================================================
DO $t14_seed$
DECLARE
  v_fin UUID; v_m UUID;
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_result JSONB;
  v_pr_id UUID;
  v_pr_version UUID;
  v_expected_version UUID;
BEGIN
  v_fin := pg_temp.mkprod('S15-T14-FIN', 'S15 T14 finished', 'pcs', 1000, 0);
  v_m   := pg_temp.mkprod('S15-T14-M',   'S15 T14 material', 'pcs', 100, 500);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_fin, v_m, 2, 'pcs', TRUE);

  SELECT id INTO v_expected_version FROM recipe_versions
    WHERE product_id = v_fin ORDER BY version_number DESC LIMIT 1;

  v_result := record_production_v1(
    p_product_id := v_fin,
    p_quantity_produced := 10,
    p_section_id := v_section,
    p_batch_number := 'T14-BATCH',
    p_quantity_waste := 0,
    p_notes := 'pgTAP T14',
    p_idempotency_key := NULL,
    p_recurse_subrecipes := TRUE
  );
  v_pr_id := (v_result->>'production_id')::uuid;
  SELECT recipe_version_id INTO v_pr_version
    FROM production_records WHERE id = v_pr_id;

  PERFORM set_config('breakery.t14_pass',
    CASE WHEN v_pr_version = v_expected_version
    THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t14_fin', v_fin::text, false);
  PERFORM set_config('breakery.t14_m', v_m::text, false);
END $t14_seed$;

SELECT ok(current_setting('breakery.t14_pass')::boolean,
  'T14: record_production_v1 stores recipe_version_id = latest recipe_versions row');

-- Flush temp tables before next record_production_v1 invocation (see header note).
DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ===========================================================================
-- T15 — cascade : 2-level recipe → 1 production_in + 2 production_out (leaves)
-- ===========================================================================
DO $t15_seed$
DECLARE
  v_fin UUID; v_int UUID; v_la UUID; v_lb UUID;
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_result JSONB;
  v_pr UUID;
  v_mvt_in INT; v_mvt_out INT;
BEGIN
  v_fin := pg_temp.mkprod('S15-T15-FIN', 'S15 T15 finished', 'pcs', 0, 0);
  v_int := pg_temp.mkprod('S15-T15-INT', 'S15 T15 intermed', 'pcs', 0, 0);
  v_la  := pg_temp.mkprod('S15-T15-LA',  'S15 T15 leaf A',   'pcs', 100, 500);
  v_lb  := pg_temp.mkprod('S15-T15-LB',  'S15 T15 leaf B',   'pcs', 150, 500);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_int, v_la, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_int, v_lb, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_int, 1, 'pcs', TRUE);

  v_result := record_production_v1(
    p_product_id := v_fin, p_quantity_produced := 5,
    p_section_id := v_section, p_batch_number := 'T15',
    p_quantity_waste := 0, p_notes := NULL,
    p_idempotency_key := NULL, p_recurse_subrecipes := TRUE
  );
  v_pr := (v_result->>'production_id')::uuid;

  -- Lookup via metadata->>'production_id' (see header note D-S13-MVTREF-01).
  SELECT COUNT(*) INTO v_mvt_in FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_in';
  SELECT COUNT(*) INTO v_mvt_out FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out';

  PERFORM set_config('breakery.t15_pass',
    CASE WHEN v_mvt_in = 1 AND v_mvt_out = 2
      AND (v_result->>'movements_count')::int = 3
    THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t15_fin', v_fin::text, false);
  PERFORM set_config('breakery.t15_int', v_int::text, false);
  PERFORM set_config('breakery.t15_pr', v_pr::text, false);
END $t15_seed$;

SELECT ok(current_setting('breakery.t15_pass')::boolean,
  'T15: cascade recurse=TRUE -> 1 production_in + 2 production_out (leaves only)');

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ===========================================================================
-- T16 — recurse=FALSE consumes the direct material (intermediate) flat
-- ===========================================================================
DO $t16_seed$
DECLARE
  v_fin UUID := current_setting('breakery.t15_fin')::uuid;
  v_int UUID := current_setting('breakery.t15_int')::uuid;
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_result JSONB;
  v_pr UUID;
  v_mvt_out INT;
  v_consumed_mat UUID;
BEGIN
  UPDATE products SET current_stock = 100 WHERE id = v_int;

  v_result := record_production_v1(
    p_product_id := v_fin, p_quantity_produced := 3,
    p_section_id := v_section, p_batch_number := 'T16',
    p_quantity_waste := 0, p_notes := NULL,
    p_idempotency_key := NULL, p_recurse_subrecipes := FALSE
  );
  v_pr := (v_result->>'production_id')::uuid;

  SELECT COUNT(*) INTO v_mvt_out FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out';
  SELECT product_id INTO v_consumed_mat FROM stock_movements
    WHERE metadata->>'production_id' = v_pr::text AND movement_type = 'production_out' LIMIT 1;

  PERFORM set_config('breakery.t16_pass',
    CASE WHEN v_mvt_out = 1 AND v_consumed_mat = v_int
    THEN 'true' ELSE 'false' END, false);
END $t16_seed$;

SELECT ok(current_setting('breakery.t16_pass')::boolean,
  'T16: recurse=FALSE consumes only direct material (intermediate) -- backward-compat flat BoM');

-- ===========================================================================
-- T17 — materials_breakdown JSONB captures is_intermediate + leaf flags
-- ===========================================================================
DO $t17$
DECLARE
  v_pr UUID := current_setting('breakery.t15_pr')::uuid;
  v_breakdown JSONB;
  v_has_intermediate BOOLEAN;
  v_has_leaf BOOLEAN;
BEGIN
  SELECT materials_breakdown INTO v_breakdown FROM production_records WHERE id = v_pr;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_breakdown) AS line
     WHERE (line->>'is_intermediate')::boolean = TRUE
  ) INTO v_has_intermediate;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_breakdown) AS line
     WHERE (line->>'leaf')::boolean = TRUE
  ) INTO v_has_leaf;

  PERFORM set_config('breakery.t17_pass',
    CASE WHEN v_has_intermediate AND v_has_leaf
    THEN 'true' ELSE 'false' END, false);
END $t17$;

SELECT ok(current_setting('breakery.t17_pass')::boolean,
  'T17: materials_breakdown JSONB contains both is_intermediate=true and leaf=true entries');

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ===========================================================================
-- T18 — Same-leaf consumption aggregated across paths.
--   FIN := 1 IX + 1 IY ; IX := 2 LEAF ; IY := 3 LEAF.
--   Quantity 4 → expect 20 LEAF in a single production_out row.
-- ===========================================================================
DO $t18_seed$
DECLARE
  v_fin UUID; v_ix UUID; v_iy UUID; v_leaf UUID;
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_result JSONB;
  v_pr UUID;
  v_out_count INT;
  v_total_qty NUMERIC;
BEGIN
  v_leaf := pg_temp.mkprod('S15-T18-LEAF', 'S15 T18 shared leaf', 'pcs', 100, 1000);
  v_ix   := pg_temp.mkprod('S15-T18-IX',   'S15 T18 IX',          'pcs', 0, 0);
  v_iy   := pg_temp.mkprod('S15-T18-IY',   'S15 T18 IY',          'pcs', 0, 0);
  v_fin  := pg_temp.mkprod('S15-T18-FIN',  'S15 T18 finished',    'pcs', 0, 0);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_ix, v_leaf, 2, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_iy, v_leaf, 3, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_ix, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_iy, 1, 'pcs', TRUE);

  v_result := record_production_v1(
    p_product_id := v_fin, p_quantity_produced := 4,
    p_section_id := v_section, p_batch_number := 'T18',
    p_quantity_waste := 0, p_notes := NULL,
    p_idempotency_key := NULL, p_recurse_subrecipes := TRUE
  );
  v_pr := (v_result->>'production_id')::uuid;

  SELECT COUNT(*), COALESCE(SUM(ABS(quantity)), 0)
    INTO v_out_count, v_total_qty
    FROM stock_movements
   WHERE metadata->>'production_id' = v_pr::text
     AND movement_type = 'production_out'
     AND product_id = v_leaf;

  PERFORM set_config('breakery.t18_pass',
    CASE WHEN v_out_count = 1 AND v_total_qty = 20
    THEN 'true' ELSE 'false' END, false);
  PERFORM set_config('breakery.t18_fin', v_fin::text, false);
END $t18_seed$;

SELECT ok(current_setting('breakery.t18_pass')::boolean,
  'T18: same leaf referenced via 2 sub-recipes -> 1 aggregated production_out movement with summed qty');

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ===========================================================================
-- T19 — Idempotency replay
-- ===========================================================================
DO $t19$
DECLARE
  v_fin UUID := current_setting('breakery.t18_fin')::uuid;
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_key UUID := gen_random_uuid();
  v_r1 JSONB; v_r2 JSONB;
  v_mvts_before INT; v_mvts_after INT;
BEGIN
  UPDATE products SET current_stock = 1000
    WHERE sku IN ('S15-T18-LEAF', 'S15-T18-IX', 'S15-T18-IY');

  v_r1 := record_production_v1(
    p_product_id := v_fin, p_quantity_produced := 2,
    p_section_id := v_section, p_batch_number := 'T19',
    p_quantity_waste := 0, p_notes := NULL,
    p_idempotency_key := v_key, p_recurse_subrecipes := TRUE
  );

  SELECT COUNT(*) INTO v_mvts_before FROM stock_movements
    WHERE metadata->>'production_id' = (v_r1->>'production_id');

  -- Replay : the function returns the existing row early (idempotency branch)
  -- BEFORE it tries to CREATE TEMP TABLE, so no DROP needed here.
  v_r2 := record_production_v1(
    p_product_id := v_fin, p_quantity_produced := 2,
    p_section_id := v_section, p_batch_number := 'T19',
    p_quantity_waste := 0, p_notes := NULL,
    p_idempotency_key := v_key, p_recurse_subrecipes := TRUE
  );

  SELECT COUNT(*) INTO v_mvts_after FROM stock_movements
    WHERE metadata->>'production_id' = (v_r1->>'production_id');

  PERFORM set_config('breakery.t19_pass',
    CASE WHEN (v_r1->>'production_id') = (v_r2->>'production_id')
      AND (v_r2->>'idempotent_replay')::boolean = TRUE
      AND v_mvts_before = v_mvts_after
    THEN 'true' ELSE 'false' END, false);
END $t19$;

SELECT ok(current_setting('breakery.t19_pass')::boolean,
  'T19: record_production_v1 idempotency replay -> same production_id, no extra movements');

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ===========================================================================
-- T20 — record_production_v1 cascade is bounded at depth 5.
--   Build a 6-edge chain P1→P2→...→P7 bottom-up (evades the BEFORE INSERT
--   trigger because each individual INSERT's descendant walk is small).
--   Then call record_production_v1 on P1 with recurse=TRUE.
--
--   Expected observable behaviour with the current Phase 1.A walker
--   (`f.depth < v_max_depth_const` in the recursive step) :
--     - depth_reached = 5 (walker stops one step short of 6).
--     - The depth-5 nodes are intermediates → excluded from leaf consumption.
--     - movements_count = 1 (only production_in for P1, no production_out).
--     - NO error raised (the `v_max_depth_reached > v_max_depth_const` check
--       is fence-post-shifted and never trips for chains built bottom-up).
--   This documents the actual contract : the BEFORE INSERT cycle trigger
--   is the canonical depth gate. Any deeper chain that evades the trigger
--   results in a silently incomplete production rather than an error.
--   Tracked as deviation pack `D-S15-1A-DEPTH-01`.
-- ===========================================================================
DO $t20_seed$
DECLARE
  ids UUID[] := ARRAY[]::UUID[];
  i INT;
  v_section UUID := current_setting('breakery.section_id')::uuid;
  v_result JSONB;
  v_pr UUID;
  v_caught TEXT;
  v_movements INT;
  v_depth INT;
BEGIN
  FOR i IN 1..7 LOOP
    ids := ids || pg_temp.mkprod('S15-T20-P' || i, 'S15 T20 P' || i, 'pcs', 100, 1000);
  END LOOP;

  -- Build chain bottom-up : P6→P7, P5→P6, ..., P1→P2 (6 edges).
  FOR i IN REVERSE 6..1 LOOP
    BEGIN
      INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
      VALUES (ids[i], ids[i+1], 1, 'pcs', TRUE);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('breakery.t20_build_err', SQLERRM, false);
      EXIT;
    END;
  END LOOP;

  BEGIN
    v_result := record_production_v1(
      p_product_id := ids[1], p_quantity_produced := 1,
      p_section_id := v_section, p_batch_number := 'T20',
      p_quantity_waste := 0, p_notes := NULL,
      p_idempotency_key := NULL, p_recurse_subrecipes := TRUE
    );
    v_caught := 'no_error';
    v_movements := (v_result->>'movements_count')::int;
    v_depth     := (v_result->>'depth_reached')::int;
  EXCEPTION WHEN OTHERS THEN
    v_caught := SQLERRM;
    v_movements := -1;
    v_depth := -1;
  END;

  PERFORM set_config('breakery.t20_caught', COALESCE(v_caught, ''), false);
  PERFORM set_config('breakery.t20_dbg', format('caught=%s movements=%s depth=%s', v_caught, v_movements, v_depth), false);

  PERFORM set_config('breakery.t20_pass',
    CASE WHEN
      (v_caught LIKE '%recipe_depth_exceeded%' OR v_caught LIKE '%recipe_cycle_detected%')
      OR (v_caught = 'no_error' AND v_movements = 1 AND v_depth <= 5)
    THEN 'true' ELSE 'false' END, false);
END $t20_seed$;

SELECT ok(
  current_setting('breakery.t20_pass')::boolean,
  'T20: 6-edge chain — record_production_v1 either raises recipe_depth_exceeded OR bounds cascade at depth 5 (1 movement, no leaf consumption). See D-S15-1A-DEPTH-01.'
);

SELECT * FROM finish();
ROLLBACK;
