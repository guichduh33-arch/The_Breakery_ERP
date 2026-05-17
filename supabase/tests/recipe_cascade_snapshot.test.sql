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
SELECT plan(28);

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

-- ============================================================================
-- Phase 1.B — tr_snapshot_on_product_cost_change tests (T15–T20)
-- Fixture reuses the same products inserted above (p_leaf, p_sub, p_top,
-- p_top2) which are all still present at this point in the transaction.
-- After Phase 1.A tests, p_sub's recipe row was hard-deleted (TEST 13).
-- We re-insert p_sub → p_leaf and p_top → p_sub, p_top2 → p_sub so the
-- ancestor graph is intact for cost_price trigger tests.
-- ============================================================================

-- Restore fixture graph (p_sub recipe was deleted in TEST 13)
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
VALUES
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 2, 'pcs', true),
  ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 3, 'pcs', true),
  ('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 1, 'pcs', true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- TEST 15: tr_snapshot_on_product_cost_change function exists
-- ============================================================================
SELECT ok(
  (SELECT COUNT(*) FROM pg_proc
   WHERE proname = 'tr_snapshot_on_product_cost_change'
     AND pronamespace = 'public'::regnamespace) = 1,
  'tr_snapshot_on_product_cost_change() function exists'
);

-- ============================================================================
-- TEST 16: trigger tr_snapshot_on_product_cost_change is attached to products
-- ============================================================================
SELECT ok(
  (SELECT COUNT(*) FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'products'
     AND t.tgname = 'tr_snapshot_on_product_cost_change') = 1,
  'trigger tr_snapshot_on_product_cost_change is attached to products table'
);

-- ============================================================================
-- TEST 17: UPDATE cost_price on leaf → snapshots for ancestors (p_sub, p_top,
--          p_top2) but NOT for the leaf itself.
-- ============================================================================
DO $$
DECLARE
  v_leaf_before INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000001');
  v_sub_before  INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000002');
  v_top_before  INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000003');
  v_top2_before INT := (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000004');
BEGIN
  -- Change leaf cost_price from 100 → 150
  UPDATE products SET cost_price = 150
  WHERE id = '10000000-0000-0000-0000-000000000001';

  -- Leaf itself: no new snapshot (it has no ancestors — it IS the leaf)
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000001') = v_leaf_before,
    format('leaf must NOT gain a snapshot: before=%s after=%s', v_leaf_before,
           (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000001'));
  -- p_sub gained 1 snapshot (it uses p_leaf)
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000002') = v_sub_before + 1,
    format('p_sub must gain 1 snapshot: before=%s after=%s', v_sub_before,
           (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000002'));
  -- p_top gained 1 snapshot (it uses p_sub which uses p_leaf)
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000003') = v_top_before + 1,
    format('p_top must gain 1 snapshot: before=%s after=%s', v_top_before,
           (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000003'));
  -- p_top2 gained 1 snapshot (it uses p_sub which uses p_leaf)
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000004') = v_top2_before + 1,
    format('p_top2 must gain 1 snapshot: before=%s after=%s', v_top2_before,
           (SELECT COUNT(*)::int FROM recipe_versions WHERE product_id = '10000000-0000-0000-0000-000000000004'));
END $$;

SELECT pass('TEST 17: UPDATE leaf cost_price → ancestors snapshotted (p_sub, p_top, p_top2), leaf NOT snapshotted (verified in DO block)');

-- ============================================================================
-- TEST 18: Noop UPDATE (same value) → zero new snapshots, no error
-- ============================================================================
DO $$
DECLARE
  v_total_before INT := (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000004'
    ));
  v_total_after  INT;
BEGIN
  -- UPDATE to same value — IS DISTINCT FROM guard must suppress snapshot
  UPDATE products SET cost_price = 150
  WHERE id = '10000000-0000-0000-0000-000000000001';

  v_total_after := (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000004'
    ));

  ASSERT v_total_after = v_total_before,
    format('noop UPDATE must produce zero new snapshots: before=%s after=%s', v_total_before, v_total_after);
END $$;

SELECT pass('TEST 18: noop UPDATE on cost_price (same value) → zero new snapshots (verified in DO block)');

-- ============================================================================
-- TEST 19: UPDATE cost_price on product with NO recipe ancestors → zero
--          snapshots, no error. Use p_top (no recipe uses p_top as material).
-- ============================================================================
DO $$
DECLARE
  v_total_before INT := (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000004'
    ));
  v_total_after  INT;
BEGIN
  -- p_top has no ancestors (nothing uses p_top as a material)
  UPDATE products SET cost_price = 999
  WHERE id = '10000000-0000-0000-0000-000000000003';

  v_total_after := (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id IN (
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000004'
    ));

  ASSERT v_total_after = v_total_before,
    format('UPDATE on product with no recipe ancestors must produce zero snapshots: before=%s after=%s', v_total_before, v_total_after);
END $$;

SELECT pass('TEST 19: UPDATE cost_price on product with no recipe ancestors → zero snapshots, no error (verified in DO block)');

-- ============================================================================
-- TEST 20: change_note matches 'material price update: <name> <old>→<new>'
-- We updated p_leaf 100→150 in TEST 17. The latest snapshot for p_sub should
-- carry that change_note.
-- ============================================================================
SELECT matches(
  (SELECT change_note FROM recipe_versions
   WHERE product_id = '10000000-0000-0000-0000-000000000002'
   ORDER BY version_number DESC LIMIT 1),
  '^material price update: .+ \S+→\S+$',
  'cascade snapshot change_note matches pattern ''material price update: <name> <old>→<new>'''
);

-- ============================================================================
-- Phase 1.C — WAC trigger tests (T21–T26)
-- tr_update_product_cost_on_purchase: AFTER INSERT ON stock_movements
-- WHEN (movement_type = 'purchase').
--
-- Fixture uses deterministic UUID range 20000000-... (distinct from Phase 1.A/B
-- range 10000000-...). Direct INSERT into stock_movements is valid here because
-- pgTAP runs as the `postgres` superuser which bypasses RLS.
--
-- WAC formula: new_cost = round((old_stock × old_cost + qty × unit_cost)
--                               / (old_stock + qty), 2)
-- Seed case (old_stock ≤ 0 OR old_cost ≤ 0): new_cost = round(unit_cost, 2)
-- ============================================================================

-- WAC fixture products
INSERT INTO products (id, sku, name, category_id, retail_price, unit, product_type, is_active, cost_price, current_stock)
SELECT x.id::uuid, x.sku, x.name,
  (SELECT id FROM categories WHERE slug = 'ingredient' LIMIT 1),
  0, 'pcs', 'finished', false, x.cost_price, x.current_stock
FROM (VALUES
  -- WAC-LEAF: leaf material with stock=0, cost=0 (seed state)
  ('20000000-0000-0000-0000-000000000001', 'WAC-LEAF',   'WAC Leaf Material',  0,   0),
  -- WAC-PARENT: parent recipe that uses WAC-LEAF (for cascade test)
  ('20000000-0000-0000-0000-000000000002', 'WAC-PARENT', 'WAC Parent Product', 0,   0),
  -- WAC-BLEND: product with existing stock=10, cost=12000 (for WAC blend test)
  ('20000000-0000-0000-0000-000000000003', 'WAC-BLEND',  'WAC Blend Product',  12000, 10),
  -- WAC-GUARD: product for guard tests (stock=10, cost=500)
  ('20000000-0000-0000-0000-000000000004', 'WAC-GUARD',  'WAC Guard Product',  500, 10)
) AS x(id, sku, name, cost_price, current_stock)
ON CONFLICT (sku) DO NOTHING;

-- WAC-PARENT recipe: uses WAC-LEAF × 2
INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
VALUES (
  '20000000-0000-0000-0000-000000000002'::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  2, 'pcs', true
) ON CONFLICT DO NOTHING;

-- ============================================================================
-- TEST 21: tr_update_product_cost_on_purchase function exists
-- ============================================================================
SELECT ok(
  (SELECT COUNT(*) FROM pg_proc
   WHERE proname = 'tr_update_product_cost_on_purchase'
     AND pronamespace = 'public'::regnamespace) = 1,
  'tr_update_product_cost_on_purchase() function exists'
);

-- ============================================================================
-- TEST 22: trigger attached to stock_movements with WHEN (purchase) clause
-- ============================================================================
SELECT ok(
  (SELECT pg_get_triggerdef(t.oid) LIKE '%WHEN ((new.movement_type = ''purchase''%'
   FROM pg_trigger t
   JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relname = 'stock_movements'
     AND t.tgname = 'tr_update_product_cost_on_purchase'),
  'trigger tr_update_product_cost_on_purchase has WHEN (movement_type = ''purchase'') clause'
);

-- ============================================================================
-- TEST 23: First-receipt seed — stock=0, cost=0 → cost_price := unit_cost
-- purchase qty=10, unit_cost=12000 → cost_price should become 12000.00
-- ============================================================================
DO $$
DECLARE
  v_profile UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1);
  v_cost    NUMERIC(14,2);
BEGIN
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, unit_cost,
    reference_type, created_by, reason
  ) VALUES (
    '20000000-0000-0000-0000-000000000001'::uuid,
    'purchase', 10, 'pcs', 12000,
    'admin_action', v_profile, 'First receipt seed test'
  );

  SELECT cost_price INTO v_cost
    FROM products WHERE id = '20000000-0000-0000-0000-000000000001'::uuid;

  ASSERT v_cost = 12000.00,
    format('TEST 23: expected cost_price=12000.00 (seed), got %s', v_cost);
END $$;

SELECT pass('TEST 23: first-receipt seed (stock=0, cost=0) → cost_price = unit_cost = 12000.00');

-- ============================================================================
-- TEST 24: WAC blend — after seed (stock=10, cost=12000), purchase qty=5
-- unit_cost=15000 → WAC = round((10×12000 + 5×15000) / 15, 2) = 13000.00
-- ============================================================================
DO $$
DECLARE
  v_profile UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1);
  v_cost    NUMERIC(14,2);
BEGIN
  -- Simulate RPC's post-INSERT stock update (seed receipt above didn't update current_stock)
  UPDATE products SET current_stock = 10
    WHERE id = '20000000-0000-0000-0000-000000000003'::uuid;

  -- WAC-BLEND already has stock=10, cost=12000 from fixture (no first receipt needed)
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, unit_cost,
    reference_type, created_by, reason
  ) VALUES (
    '20000000-0000-0000-0000-000000000003'::uuid,
    'purchase', 5, 'pcs', 15000,
    'admin_action', v_profile, 'WAC blend test'
  );

  SELECT cost_price INTO v_cost
    FROM products WHERE id = '20000000-0000-0000-0000-000000000003'::uuid;

  -- (10×12000 + 5×15000) / 15 = (120000 + 75000) / 15 = 195000 / 15 = 13000.00
  ASSERT v_cost = 13000.00,
    format('TEST 24: expected WAC=13000.00, got %s', v_cost);
END $$;

SELECT pass('TEST 24: WAC blend (10×12000 + 5×15000) / 15 = 13000.00');

-- ============================================================================
-- TEST 25: End-to-end cascade — purchase on WAC-LEAF → cost_price changes →
-- tr_snapshot_on_product_cost_change fires → WAC-PARENT gains snapshot
-- with change_note matching 'material price update: %'
-- ============================================================================
DO $$
DECLARE
  v_profile      UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1);
  v_parent_before INT;
  v_parent_after  INT;
  v_note          TEXT;
BEGIN
  v_parent_before := (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id = '20000000-0000-0000-0000-000000000002'::uuid);

  -- Purchase on WAC-LEAF (stock=0, cost now 12000 from TEST 23).
  -- Simulate stock back to 0 so we do a second seed-branch (unit_cost=15000)
  UPDATE products SET current_stock = 0, cost_price = 0
    WHERE id = '20000000-0000-0000-0000-000000000001'::uuid;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, unit_cost,
    reference_type, created_by, reason
  ) VALUES (
    '20000000-0000-0000-0000-000000000001'::uuid,
    'purchase', 8, 'pcs', 20000,
    'admin_action', v_profile, 'Cascade test purchase'
  );

  v_parent_after := (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id = '20000000-0000-0000-0000-000000000002'::uuid);

  SELECT change_note INTO v_note
    FROM recipe_versions
    WHERE product_id = '20000000-0000-0000-0000-000000000002'::uuid
    ORDER BY version_number DESC LIMIT 1;

  ASSERT v_parent_after > v_parent_before,
    format('TEST 25: WAC-PARENT must gain ≥1 snapshot; before=%s after=%s', v_parent_before, v_parent_after);
  ASSERT v_note LIKE 'material price update: %',
    format('TEST 25: cascade change_note must match pattern; got: %s', v_note);
END $$;

SELECT pass('TEST 25: end-to-end cascade — purchase on leaf → WAC update → ancestor snapshots (verified in DO block)');

-- ============================================================================
-- TEST 26: Non-purchase movements do NOT change cost_price (WHEN clause guard)
-- Insert 'incoming' and 'adjustment_in' movements with unit_cost=99999.
-- cost_price for WAC-GUARD must remain 500.
-- ============================================================================
DO $$
DECLARE
  v_profile UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1);
  v_cost    NUMERIC(14,2);
BEGIN
  -- incoming movement (triggers WAC? NO — WHEN clause filters it)
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, unit_cost,
    reference_type, created_by, reason
  ) VALUES (
    '20000000-0000-0000-0000-000000000004'::uuid,
    'incoming', 5, 'pcs', 99999,
    'admin_action', v_profile, 'Non-purchase incoming guard test'
  );

  SELECT cost_price INTO v_cost
    FROM products WHERE id = '20000000-0000-0000-0000-000000000004'::uuid;
  ASSERT v_cost = 500,
    format('TEST 26a: incoming must not change cost_price; got %s', v_cost);

  -- adjustment_in movement (also filtered by WHEN clause)
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, unit_cost,
    reference_type, created_by, reason, from_section_id
  ) VALUES (
    '20000000-0000-0000-0000-000000000004'::uuid,
    'adjustment_in', 5, 'pcs', 99999,
    'admin_action', v_profile, 'Non-purchase adj guard test',
    (SELECT id FROM sections LIMIT 1)
  );

  SELECT cost_price INTO v_cost
    FROM products WHERE id = '20000000-0000-0000-0000-000000000004'::uuid;
  ASSERT v_cost = 500,
    format('TEST 26b: adjustment_in must not change cost_price; got %s', v_cost);
END $$;

SELECT pass('TEST 26: non-purchase movements (incoming, adjustment_in) do NOT change cost_price (WHEN clause guard verified)');

-- ============================================================================
-- TEST 27: unit_cost = 0 (free goods) → trigger skips, cost_price unchanged
-- ============================================================================
DO $$
DECLARE
  v_profile UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1);
  v_cost    NUMERIC(14,2);
BEGIN
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, unit_cost,
    reference_type, created_by, reason
  ) VALUES (
    '20000000-0000-0000-0000-000000000004'::uuid,
    'purchase', 5, 'pcs', 0,
    'admin_action', v_profile, 'Free goods zero cost test'
  );

  SELECT cost_price INTO v_cost
    FROM products WHERE id = '20000000-0000-0000-0000-000000000004'::uuid;
  ASSERT v_cost = 500,
    format('TEST 27: unit_cost=0 must not change cost_price; got %s', v_cost);
END $$;

SELECT pass('TEST 27: purchase with unit_cost=0 (free goods) → trigger skips, cost_price unchanged');

-- ============================================================================
-- TEST 28: WAC no-op — unit_cost equals existing cost_price → IS DISTINCT FROM
-- guard suppresses UPDATE, no new recipe_versions snapshot created
-- WAC-GUARD: stock=10, cost=500. Purchase qty=10, unit_cost=500.
-- WAC = (10×500 + 10×500) / 20 = 500.00 → IS DISTINCT FROM 500 is FALSE → no UPDATE
-- ============================================================================
DO $$
DECLARE
  v_profile    UUID := (SELECT id FROM user_profiles WHERE deleted_at IS NULL LIMIT 1);
  v_cost       NUMERIC(14,2);
  v_snap_count INT;
BEGIN
  -- Insert a recipe so WAC-GUARD has an ancestor graph (to confirm no spurious snapshots)
  -- WAC-GUARD acts as a material in a dummy parent for this test
  -- (We just check cost_price is unchanged — no ancestor needed for the guard test)

  v_snap_count := (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id = '20000000-0000-0000-0000-000000000004'::uuid);

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, unit_cost,
    reference_type, created_by, reason
  ) VALUES (
    '20000000-0000-0000-0000-000000000004'::uuid,
    'purchase', 10, 'pcs', 500,
    'admin_action', v_profile, 'Noop WAC idempotency test'
  );

  SELECT cost_price INTO v_cost
    FROM products WHERE id = '20000000-0000-0000-0000-000000000004'::uuid;
  ASSERT v_cost = 500.00,
    format('TEST 28: noop WAC must leave cost_price=500.00; got %s', v_cost);

  -- No new snapshot for WAC-GUARD (cost_price unchanged → tr_snapshot_on_product_cost_change does not fire)
  ASSERT (SELECT COUNT(*)::int FROM recipe_versions
    WHERE product_id = '20000000-0000-0000-0000-000000000004'::uuid) = v_snap_count,
    'TEST 28: noop WAC must not create new recipe_versions rows';
END $$;

SELECT pass('TEST 28: noop WAC (unit_cost=old_cost) → IS DISTINCT FROM guard suppresses UPDATE, no snapshot added');

SELECT * FROM finish();
ROLLBACK;
