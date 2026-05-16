-- supabase/tests/recipe_cascade_snapshot.test.sql
-- Session 17 — Phase 1.A — recipes mutation cascade snapshot tests.
-- (Phase 1.B will append cost_price trigger tests, Phase 1.C WAC tests.)
--
-- Fixture topology (created inside transaction, rolled back at end):
--
--   p_leaf  (raw ingredient, no recipe)   cost_price = 100
--   p_sub   (sub-recipe)  recipe: 2 pcs of p_leaf  → expected cost = 200
--   p_top   (top product) recipe: 3 pcs of p_sub   → expected cost = 600
--   p_top2  (second top)  recipe: 1 pcs of p_sub   → expected cost = 200
--
-- Cascade graph when we mutate p_sub's recipe:
--   direct edit  → snapshot p_sub
--   ancestors    → p_top (uses p_sub), p_top2 (uses p_sub)
--
-- All products use unit='pcs' so convert_quantity is identity (no conversion needed).

BEGIN;
SELECT plan(14);

-- ============================================================================
-- FIXTURES
-- ============================================================================
-- Grab a valid category_id (ingredient) so FK is satisfied.
DO $$
DECLARE
  v_cat UUID := (SELECT id FROM categories WHERE slug = 'ingredient' LIMIT 1);
BEGIN
  ASSERT v_cat IS NOT NULL, 'fixture: ingredient category not found';
END $$;

-- Insert test products using deterministic UUIDs (safe — rolled back after test).
INSERT INTO products (id, sku, name, category_id, retail_price, unit, product_type, is_active, cost_price)
SELECT
  x.id::uuid, x.sku, x.name,
  (SELECT id FROM categories WHERE slug = 'ingredient' LIMIT 1),
  0, 'pcs', 'finished', false, x.cost_price
FROM (VALUES
  ('10000000-0000-0000-0000-000000000001', 'TST-LEAF', 'Test Leaf Ingredient',  100),
  ('10000000-0000-0000-0000-000000000002', 'TST-SUB',  'Test Sub-Recipe',        0),
  ('10000000-0000-0000-0000-000000000003', 'TST-TOP',  'Test Top Product',        0),
  ('10000000-0000-0000-0000-000000000004', 'TST-TOP2', 'Test Top Product 2',      0)
) AS x(id, sku, name, cost_price)
ON CONFLICT (sku) DO NOTHING;

-- Record baseline recipe_versions counts before any recipe insertions.
-- (The products are brand-new so count should be 0 for each.)
DO $$
DECLARE
  v_leaf UUID := '10000000-0000-0000-0000-000000000001';
  v_sub  UUID := '10000000-0000-0000-0000-000000000002';
  v_top  UUID := '10000000-0000-0000-0000-000000000003';
  v_top2 UUID := '10000000-0000-0000-0000-000000000004';
BEGIN
  ASSERT (SELECT COUNT(*) FROM recipe_versions WHERE product_id IN (v_leaf, v_sub, v_top, v_top2)) = 0,
    'fixture: new products must start with zero recipe_versions rows';
END $$;

-- ============================================================================
-- TEST 1: _snapshot_recipe_version helper exists and returns UUID
-- ============================================================================
SELECT ok(
  (SELECT COUNT(*) FROM pg_proc
   WHERE proname = '_snapshot_recipe_version'
     AND pronamespace = 'public'::regnamespace
     AND pg_get_function_result(oid) = 'uuid') = 1,
  '_snapshot_recipe_version(uuid,text,uuid) exists and returns uuid'
);

-- ============================================================================
-- TEST 2: tr_snapshot_recipe_version has no WHEN OTHERS block
-- ============================================================================
SELECT ok(
  (SELECT prosrc NOT LIKE '%WHEN OTHERS%'
   FROM pg_proc
   WHERE proname = 'tr_snapshot_recipe_version'
     AND pronamespace = 'public'::regnamespace),
  'tr_snapshot_recipe_version has no WHEN OTHERS block'
);

-- ============================================================================
-- TEST 3: tr_snapshot_recipe_version contains WITH RECURSIVE ancestors
-- ============================================================================
SELECT ok(
  (SELECT prosrc LIKE '%WITH RECURSIVE ancestors%'
   FROM pg_proc
   WHERE proname = 'tr_snapshot_recipe_version'
     AND pronamespace = 'public'::regnamespace),
  'tr_snapshot_recipe_version contains WITH RECURSIVE ancestors walk'
);

-- ============================================================================
-- TEST 4: tr_snapshot_recipe_version contains pg_trigger_depth guard
-- ============================================================================
SELECT ok(
  (SELECT prosrc LIKE '%pg_trigger_depth()%'
   FROM pg_proc
   WHERE proname = 'tr_snapshot_recipe_version'
     AND pronamespace = 'public'::regnamespace),
  'tr_snapshot_recipe_version preserves pg_trigger_depth() > 1 guard'
);

-- ============================================================================
-- Insert p_sub recipe (p_sub uses p_leaf × 2).
-- Expected trigger effect: snapshot for p_sub only (no ancestors of p_sub yet).
-- ============================================================================
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
VALUES (
  '10000000-0000-0000-0000-000000000002',  -- p_sub
  '10000000-0000-0000-0000-000000000001',  -- p_leaf
  2, 'pcs', true
);

-- ============================================================================
-- TEST 5: INSERT recipe for p_sub → exactly 1 snapshot row for p_sub
-- ============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000002'),
  1,
  'INSERT recipe for p_sub creates exactly 1 snapshot for p_sub'
);

-- ============================================================================
-- TEST 6: snapshot change_note for direct INSERT is 'insert'
-- ============================================================================
SELECT is(
  (SELECT change_note FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000002'
   ORDER BY version_number DESC LIMIT 1),
  'insert',
  'direct recipe INSERT produces change_note = ''insert'''
);

-- ============================================================================
-- TEST 7: product_cost_at_version matches _calculate_recipe_cost_walk
-- p_sub has 2 × p_leaf (cost_price=100), unit=pcs → expected cost = 200
-- ============================================================================
SELECT is(
  (SELECT (snapshot->>'product_cost_at_version')::NUMERIC(14,2)
   FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000002'
   ORDER BY version_number DESC LIMIT 1),
  (SELECT ((
    _calculate_recipe_cost_walk(
      '10000000-0000-0000-0000-000000000002', 5, 1, ARRAY[]::UUID[]
    ))->>'cost_per_unit')::NUMERIC(14,2)),
  'product_cost_at_version for p_sub matches _calculate_recipe_cost_walk cost_per_unit'
);

-- ============================================================================
-- Insert p_top and p_top2 recipes (both use p_sub).
-- Each INSERT fires the trigger — but at this point p_sub has no ancestors,
-- so each INSERT only creates 1 snapshot for p_top / p_top2 respectively.
-- ============================================================================
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
VALUES (
  '10000000-0000-0000-0000-000000000003',  -- p_top
  '10000000-0000-0000-0000-000000000002',  -- p_sub
  3, 'pcs', true
);

INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
VALUES (
  '10000000-0000-0000-0000-000000000004',  -- p_top2
  '10000000-0000-0000-0000-000000000002',  -- p_sub
  1, 'pcs', true
);

-- Record counts after inserting p_top and p_top2 recipes.
-- At this point: p_sub=1, p_top=1, p_top2=1 (each from their own direct INSERT).
-- Note: p_top INSERT snapshotted p_top (direct) + p_sub's ancestor = p_top got its snapshot.
-- The trigger for p_top INSERT: direct product = p_top, no ancestors of p_top yet → 1 snapshot.
-- The trigger for p_top2 INSERT: direct product = p_top2, no ancestors of p_top2 yet → 1 snapshot.

-- ============================================================================
-- TEST 8: p_top has exactly 1 snapshot after its recipe INSERT
-- ============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000003'),
  1,
  'p_top has 1 snapshot after its own recipe INSERT (no ancestors of p_top yet)'
);

-- ============================================================================
-- Now mutate p_sub's recipe (UPDATE the quantity). This should trigger:
--   1 snapshot for p_sub (direct edit)
--   1 snapshot for p_top (ancestor)
--   1 snapshot for p_top2 (ancestor)
-- Total new rows = 3 (delta from current counts).
-- ============================================================================
DO $$
DECLARE
  v_sub_before  INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000002');
  v_top_before  INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000003');
  v_top2_before INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000004');
  v_sub_after   INT;
  v_top_after   INT;
  v_top2_after  INT;
BEGIN
  -- UPDATE p_sub's recipe (change quantity from 2 to 3)
  UPDATE recipes SET quantity = 3
  WHERE product_id = '10000000-0000-0000-0000-000000000002'
    AND material_id = '10000000-0000-0000-0000-000000000001';

  v_sub_after  := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000002');
  v_top_after  := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000003');
  v_top2_after := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000004');

  ASSERT v_sub_after  = v_sub_before  + 1, format('expected p_sub  +1 snapshot, got before=%s after=%s', v_sub_before,  v_sub_after);
  ASSERT v_top_after  = v_top_before  + 1, format('expected p_top  +1 snapshot, got before=%s after=%s', v_top_before,  v_top_after);
  ASSERT v_top2_after = v_top2_before + 1, format('expected p_top2 +1 snapshot, got before=%s after=%s', v_top2_before, v_top2_after);
END $$;

-- ============================================================================
-- TEST 9: After UPDATE on p_sub's recipe, p_sub gained exactly 1 new snapshot
-- ============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000002'),
  2,
  'UPDATE on p_sub recipe: p_sub now has 2 snapshots (append-only invariant)'
);

-- ============================================================================
-- TEST 10: After UPDATE on p_sub's recipe, p_top gained exactly 1 cascade snapshot
-- ============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000003'),
  2,
  'UPDATE on p_sub recipe: p_top gained 1 cascade snapshot (now has 2 total)'
);

-- ============================================================================
-- TEST 11: After UPDATE on p_sub's recipe, p_top2 gained exactly 1 cascade snapshot
-- ============================================================================
SELECT is(
  (SELECT COUNT(*)::int FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000004'),
  2,
  'UPDATE on p_sub recipe: p_top2 gained 1 cascade snapshot (now has 2 total)'
);

-- ============================================================================
-- TEST 12: Cascade snapshot change_note matches 'cascade: % changed'
-- ============================================================================
SELECT ok(
  (SELECT change_note LIKE 'cascade: % changed'
   FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000003'
   ORDER BY version_number DESC LIMIT 1),
  'cascade snapshot change_note matches pattern ''cascade: % changed'''
);

-- ============================================================================
-- TEST 13: DELETE on p_sub recipe row also fires cascade snapshots
-- ============================================================================
DO $$
DECLARE
  v_sub_before  INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000002');
  v_top_before  INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000003');
  v_top2_before INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000004');
BEGIN
  -- Hard delete the recipe row (soft-delete not tested here — trigger fires on real DELETE)
  DELETE FROM recipes
  WHERE product_id = '10000000-0000-0000-0000-000000000002'
    AND material_id = '10000000-0000-0000-0000-000000000001';

  -- After DELETE: p_sub has no active recipe rows, but the trigger still fires.
  -- p_sub snapshot: items=[], cost=0 (leaf with no recipe).
  -- Ancestor cascade: p_top and p_top2 still have p_sub as material → both get snapshots.
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000002') > v_sub_before,
    'DELETE on p_sub recipe row: p_sub snapshot count must increase';
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000003') > v_top_before,
    'DELETE on p_sub recipe row: p_top cascade snapshot count must increase';
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000004') > v_top2_before,
    'DELETE on p_sub recipe row: p_top2 cascade snapshot count must increase';
END $$;

SELECT pass('TEST 13: DELETE on p_sub recipe triggers cascade for p_sub, p_top, p_top2 (verified in DO block above)');

-- ============================================================================
-- TEST 14: Append-only invariant — recipe_versions row count only increases
-- (version_number is monotonically increasing per product_id)
-- ============================================================================
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM (
      SELECT product_id, version_number,
             LAG(version_number) OVER (PARTITION BY product_id ORDER BY version_number) AS prev_version
      FROM recipe_versions
      WHERE product_id IN (
        '10000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000004'
      )
    ) t
    WHERE prev_version IS NOT NULL
      AND version_number <= prev_version
  ),
  'recipe_versions version_number is strictly monotonically increasing per product (append-only)'
);

SELECT * FROM finish();
ROLLBACK;
