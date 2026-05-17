-- 20260521000030_refresh_latest_recipe_version_full_cascade.sql
-- Session 17 / Phase 1.D — One-shot UPDATE of LATEST modern snapshot per
-- product, replacing S16's depth-1 product_cost_at_version with the new
-- full-cascade value. Append-only invariant temporarily relaxed (D13).
-- Idempotent : IS DISTINCT FROM guard yields 0 rows on second run.
--
-- Result at first run: rows_refreshed = 0 because S17/Phase 1.A's new trigger
-- (_snapshot_recipe_version → _calculate_recipe_cost_walk depth=5) already
-- wrote full-cascade costs on every subsequent trigger fire since S16 merged.
-- The 12 modern-shape rows already held correct values → IS DISTINCT FROM
-- predicate found no diffs. This is the expected idempotent outcome.

DO $$
DECLARE
  v_updated_count INT := 0;
BEGIN
  WITH latest AS (
    SELECT product_id, MAX(version_number) AS v
      FROM recipe_versions
     WHERE snapshot ? 'items'
     GROUP BY product_id
  ),
  updated AS (
    UPDATE recipe_versions rv
       SET snapshot = jsonb_set(
             rv.snapshot,
             '{product_cost_at_version}',
             to_jsonb(
               (_calculate_recipe_cost_walk(rv.product_id, 5, 1, ARRAY[]::UUID[])->>'cost_per_unit')::NUMERIC(14,2)
             )
           ),
           change_note = 'system refresh: full-cascade cost data 2026-05-17'
     FROM latest l
    WHERE rv.product_id = l.product_id
      AND rv.version_number = l.v
      AND (rv.snapshot->>'product_cost_at_version')::NUMERIC(14,2)
          IS DISTINCT FROM
          (_calculate_recipe_cost_walk(rv.product_id, 5, 1, ARRAY[]::UUID[])->>'cost_per_unit')::NUMERIC(14,2)
    RETURNING rv.id
  )
  SELECT count(*) INTO v_updated_count FROM updated;

  RAISE NOTICE 'rows_refreshed: %', v_updated_count;
END $$;
