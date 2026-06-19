-- supabase/tests/combo_migration.test.sql
-- Session 47 / Task A4 — asserts the legacy combo_items → choice-group backfill.
-- Read-only post-migration checks (the migration is one-shot; nothing to seed).
BEGIN;
SELECT plan(5);
SELECT is((SELECT count(DISTINCT combo_product_id)::int FROM combo_groups), 7, 'M1 all 7 legacy combos have groups');
SELECT is((SELECT count(*)::int FROM combo_group_options), 18, 'M2 18 options backfilled (one per legacy combo_item)');
SELECT is((SELECT count(*)::int FROM products WHERE product_type='combo' AND combo_base_price IS NULL), 0, 'M3 combo_base_price seeded from retail_price');
SELECT hasnt_table('combo_items', 'M4 combo_items table dropped');
SELECT is(
  (SELECT count(*)::int FROM combo_groups g JOIN products p ON p.id=g.combo_product_id WHERE p.sku='COMBO-001'),
  2, 'M5 COMBO-001 migrated to 2 groups (Americano + Croissant)');
SELECT * FROM finish();
ROLLBACK;
