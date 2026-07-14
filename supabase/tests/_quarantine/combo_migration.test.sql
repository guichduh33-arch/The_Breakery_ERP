-- supabase/tests/combo_migration.test.sql
-- ⚠️ OBSOLETE — exclusion datée 2026-07-14 (S77, triage nightly).
-- Test d'acceptance ONE-SHOT du backfill S47 (combo_items → choice-groups) qui
-- assertait les comptes EXACTS du catalogue de l'époque (7 combos, 18 options).
-- Le CRUD combos BO a depuis fait vivre le catalogue : 9 combos / 36 options au
-- 2026-07-14 → M1/M2 rouges par construction ; réparer = re-pinner des comptes
-- qui re-pourriront. M4 (combo_items droppée) reste vrai ; la structure combo
-- COURANTE est couverte VERT par combo_crud / combo_server_pricing / combo_sale.
-- ⚠️ Au passage, M3 a révélé un point réel : 1 combo vivant a combo_base_price
-- NULL (créé via BO) — signalé comme finding S77 dans l'INDEX, à traiter comme
-- garde produit (pas comme test de migration).
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
