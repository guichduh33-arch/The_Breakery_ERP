-- supabase/tests/f6_sub_recipes.test.sql
-- Session 15 / Phase 1.C — F6 sub-recipes : pgTAP acceptance suite.
--
-- Covers the 7 migrations 20260519000001..000010 (anti-cycle trigger,
-- calculate_recipe_cost_v1, recipe_versions snapshot, backfill,
-- production_records.recipe_version_id, the record_production cascade,
-- production_records.materials_breakdown) PLUS the Phase 2.A yield-aware
-- extension (migrations 20260519000040..000044). The suite runs against the
-- live version of the RPC, today record_production_v5 (20260729000005,
-- ADR-008 D2/D3/D9) ; all products created by pg_temp.mkprod keep the
-- products.deduct_stock default (true) so the D6 refusal never fires here.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- ADR-016 (20260729000001) — the cascade now STOPS at the first intermediate
-- with `track_inventory = true` and consumes it from its own stock, instead
-- of always diving to raw-material leaves. `products.track_inventory`
-- DEFAULTS to true, so any intermediate created by `pg_temp.mkprod` without
-- an explicit flag is now a stocked leaf as far as the cascade is concerned.
-- T15/T16/T17/T18/T20 below exercise the "dive to raw-material leaves"
-- branch, which ADR-016 keeps for NON-stocked intermediates only — their
-- intermediates are therefore created with the new explicit
-- `p_track_inventory := false` argument. The "stop at a stocked
-- intermediate" branch is NOT re-tested here (it would just make these tests
-- redundant with themselves) — it has dedicated coverage in
-- supabase/tests/adr016_descente_semi_finis.test.sql.
--
-- CLOSED (ADR-008 D9.3, 20260729000005) : record_production_v5 now drops its
-- own `_bom_flatten` / `_leaf_consumption` temp tables before creating them, so
-- calling it twice inside one transaction no longer collides with
-- `relation "_bom_flatten" already exists`. The explicit
-- `DROP TABLE IF EXISTS pg_temp.…` statements left between invocations below
-- are harmless leftovers of the previous behaviour, not a requirement — the
-- deviation pack `D-S15-1A-TEMPTBL-01` is settled.
--
-- KNOWN UPSTREAM (Session 13) BEHAVIOUR : record_stock_movement_v1 (the
-- shared primitive) hardcodes `reference_type='admin_action'` and never
-- populates `reference_id`. Therefore production-related stock_movements
-- are NOT findable via `WHERE reference_type='production' AND reference_id=
-- production_id`. They ARE findable via the `metadata->>'production_id'`
-- JSONB tag injected by record_production_v5. This pgTAP suite uses the
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
--   T15 record_production_v5 cascade : 2-level recipe → leaf-only out movements.
--   T16 record_production_v5 recurse=FALSE falls back to flat behaviour.
--   T17 materials_breakdown captures is_intermediate flag for intermediates.
--   T18 record_production_v5 aggregates same-leaf consumption across paths.
--   T19 record_production_v5 idempotency replay returns same production_id.
--   T20 record_production_v5 depth>5 raises recipe_depth_exceeded.

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
-- ADR-016 : p_track_inventory defaults to TRUE (matches the products.track_inventory
-- column default) ; pass FALSE explicitly for an intermediate that must remain
-- diveable to its own leaf materials under the cascade "stop at stocked" rule.
CREATE OR REPLACE FUNCTION pg_temp.mkprod(p_sku TEXT, p_name TEXT, p_unit TEXT, p_cost DECIMAL, p_stock DECIMAL DEFAULT 1000, p_track_inventory BOOLEAN DEFAULT TRUE)
RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_id UUID; v_cat UUID;
BEGIN
  v_cat := current_setting('breakery.category_id')::uuid;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active, track_inventory)
  VALUES (p_sku, p_name, v_cat, 100, p_stock, p_unit, p_cost, 'finished', TRUE, p_track_inventory)
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
-- T5 — Over-depth chain rejected with recipe_depth_exceeded.
--   Two depth gates now enforce max=5 on a recipe chain : the BEFORE-INSERT
--   cycle trigger (validate_recipe_no_cycle, walks descendants of the material)
--   AND the AFTER snapshot trigger (tr_snapshot_recipe_version ->
--   _snapshot_recipe_version -> _calculate_recipe_cost_walk, walks the cost tree
--   of the product). The cost-walk fires on every write and is the stricter of
--   the two here, so a 6-edge chain can no longer be assembled at all.
--   Seed a 5-edge chain P3→P4→…→P8 (both gates tolerate depth 5), then INSERT
--   P2→P3 : that makes the P2 chain 6 deep and _calculate_recipe_cost_walk
--   raises recipe_depth_exceeded (P0001). This is what the depth cap must do.
-- ===========================================================================
DO $t5_seed$
DECLARE
  v_p2 UUID; v_p3 UUID; v_p4 UUID; v_p5 UUID; v_p6 UUID; v_p7 UUID; v_p8 UUID;
BEGIN
  v_p2  := pg_temp.mkprod('S15-T5-P2',  'S15 T5 P2',  'pcs', 100);
  v_p3  := pg_temp.mkprod('S15-T5-P3',  'S15 T5 P3',  'pcs', 100);
  v_p4  := pg_temp.mkprod('S15-T5-P4',  'S15 T5 P4',  'pcs', 100);
  v_p5  := pg_temp.mkprod('S15-T5-P5',  'S15 T5 P5',  'pcs', 100);
  v_p6  := pg_temp.mkprod('S15-T5-P6',  'S15 T5 P6',  'pcs', 100);
  v_p7  := pg_temp.mkprod('S15-T5-P7',  'S15 T5 P7',  'pcs', 100);
  v_p8  := pg_temp.mkprod('S15-T5-P8',  'S15 T5 P8',  'pcs', 100);

  -- Build a 5-edge chain bottom-up : P7→P8, P6→P7, …, P3→P4 (depth 5, tolerated).
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p7, v_p8, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p6, v_p7, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p5, v_p6, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p4, v_p5, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active) VALUES (v_p3, v_p4, 1, 'pcs', TRUE);

  PERFORM set_config('breakery.t5_p2', v_p2::text, false);
  PERFORM set_config('breakery.t5_p3', v_p3::text, false);
END $t5_seed$;

-- INSERT P2→P3 — makes the P2 chain 6 deep → cost-walk raises recipe_depth_exceeded.
SELECT throws_ok(
  format($q$INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
           VALUES (%L::uuid, %L::uuid, 1, 'pcs', TRUE)$q$,
         current_setting('breakery.t5_p2'),
         current_setting('breakery.t5_p3')),
  'P0001',
  'recipe_depth_exceeded',
  'T5: 6-deep chain triggers recipe_depth_exceeded on the P2->P3 INSERT'
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
  -- The recipe_versions.snapshot is now an object {items:[…],
  -- product_cost_at_version:…} rather than a bare array of lines — the recipe
  -- rows live under ->'items'.
  PERFORM set_config('breakery.t11_pass',
    CASE WHEN v_cnt = 1 AND v_vn = 1 AND jsonb_array_length(v_snap->'items') = 1
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
\ir helpers/f6_production_checks.sql
SELECT * FROM finish();
ROLLBACK;
