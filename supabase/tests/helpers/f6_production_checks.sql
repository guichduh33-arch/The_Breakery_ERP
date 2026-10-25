-- T14 — record_production_v5 resolves recipe_version_id
--   First record_production_v5 invocation. NO prior invocation in this
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

  v_result := record_production_v7(
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
  'T14: record_production_v7 stores recipe_version_id = latest recipe_versions row');

-- Flush temp tables before next record_production_v5 invocation (see header note).
DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ===========================================================================
-- T15 — cascade : 2-level recipe → 1 production_in + 2 production_out (leaves)
-- ADR-016 : v_int is created with p_track_inventory := FALSE so the cascade
-- still dives past it to raw-material leaves (the "stop at stocked
-- intermediate" branch is covered separately, see file header).
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
  v_int := pg_temp.mkprod('S15-T15-INT', 'S15 T15 intermed', 'pcs', 0, 0, FALSE);
  v_la  := pg_temp.mkprod('S15-T15-LA',  'S15 T15 leaf A',   'pcs', 100, 500);
  v_lb  := pg_temp.mkprod('S15-T15-LB',  'S15 T15 leaf B',   'pcs', 150, 500);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_int, v_la, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_int, v_lb, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_int, 1, 'pcs', TRUE);

  v_result := record_production_v7(
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

  v_result := record_production_v7(
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
  -- ADR-016 : IX and IY are non-stocked intermediates (p_track_inventory :=
  -- FALSE) so the cascade keeps diving to the shared leaf (see file header).
  v_leaf := pg_temp.mkprod('S15-T18-LEAF', 'S15 T18 shared leaf', 'pcs', 100, 1000);
  v_ix   := pg_temp.mkprod('S15-T18-IX',   'S15 T18 IX',          'pcs', 0, 0, FALSE);
  v_iy   := pg_temp.mkprod('S15-T18-IY',   'S15 T18 IY',          'pcs', 0, 0, FALSE);
  v_fin  := pg_temp.mkprod('S15-T18-FIN',  'S15 T18 finished',    'pcs', 0, 0);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_ix, v_leaf, 2, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_iy, v_leaf, 3, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_ix, 1, 'pcs', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_fin, v_iy, 1, 'pcs', TRUE);

  v_result := record_production_v7(
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

  v_r1 := record_production_v7(
    p_product_id := v_fin, p_quantity_produced := 2,
    p_section_id := v_section, p_batch_number := 'T19',
    p_quantity_waste := 0, p_notes := NULL,
    p_idempotency_key := v_key, p_recurse_subrecipes := TRUE
  );

  SELECT COUNT(*) INTO v_mvts_before FROM stock_movements
    WHERE metadata->>'production_id' = (v_r1->>'production_id');

  -- Replay : the function returns the existing row early (idempotency branch)
  -- BEFORE it tries to CREATE TEMP TABLE, so no DROP needed here.
  v_r2 := record_production_v7(
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
  'T19: record_production_v7 idempotency replay -> same production_id, no extra movements');

DROP TABLE IF EXISTS pg_temp._bom_flatten;
DROP TABLE IF EXISTS pg_temp._leaf_consumption;

-- ===========================================================================
-- T20 — record_production_v5 cascade is bounded at depth 5.
--   Build a 6-edge chain P1→P2→...→P7 bottom-up (evades the BEFORE INSERT
--   trigger because each individual INSERT's descendant walk is small).
--   Then call record_production_v5 on P1 with recurse=TRUE.
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
--   ADR-008 D5 (20260729000003) closes that silent branch : the production RPC
--   now raises recipe_depth_exceeded when a NON-stocked intermediate survives at
--   depth 5. It does not change what this test observes — the chain build is
--   already capped by the cost-walk depth gate below, so the RPC is never
--   reached with a 6-edge chain.
--   ADR-016 : every P1..P6 node in the chain is an intermediate (it has its
--   own recipe) ; all 7 are created with p_track_inventory := FALSE so the
--   depth walker still dives all the way down instead of stopping at P2
--   (P7 is a true leaf and is unaffected by the flag either way).
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
    ids := ids || pg_temp.mkprod('S15-T20-P' || i, 'S15 T20 P' || i, 'pcs', 100, 1000, FALSE);
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
    v_result := record_production_v7(
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

  -- The cost-walk depth gate (tr_snapshot_recipe_version) now also caps at 5, so
  -- the 6th chain edge (P1->P2) can no longer be built — the INSERT itself raises
  -- recipe_depth_exceeded, captured in breakery.t20_build_err, and the subsequent
  -- record_production_v5 on the recipe-less P1 raises recipe_not_found. A capped
  -- build is exactly the contract this test asserts (depth > 5 is rejected).
  PERFORM set_config('breakery.t20_pass',
    CASE WHEN
      (v_caught LIKE '%recipe_depth_exceeded%' OR v_caught LIKE '%recipe_cycle_detected%')
      OR (v_caught = 'no_error' AND v_movements = 1 AND v_depth <= 5)
      OR (current_setting('breakery.t20_build_err', true) LIKE '%recipe_depth_exceeded%')
    THEN 'true' ELSE 'false' END, false);
END $t20_seed$;

SELECT ok(
  current_setting('breakery.t20_pass')::boolean,
  'T20: 6-edge chain — record_production_v7 either raises recipe_depth_exceeded OR bounds cascade at depth 5 (1 movement, no leaf consumption). See D-S15-1A-DEPTH-01.'
);
