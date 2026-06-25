-- supabase/tests/route_categories_prep_stations.test.sql
BEGIN;
SELECT plan(3);

SELECT is(
  (SELECT count(*)::int FROM categories
    WHERE name IN ('Coffee','Speciale Latte','Special Drinks')
      AND dispatch_station = 'barista'),
  3, 'three barista categories routed');

SELECT is(
  (SELECT count(*)::int FROM categories
    WHERE name IN ('Simple Plate','Panini','Savoury Croissant')
      AND dispatch_station = 'kitchen'),
  3, 'three kitchen categories routed');

-- Idempotence: re-running the UPDATEs is a no-op (still routed, no error).
UPDATE categories SET dispatch_station = 'barista'
  WHERE name IN ('Coffee','Speciale Latte','Special Drinks')
    AND dispatch_station IS DISTINCT FROM 'barista';
SELECT is(
  (SELECT count(*)::int FROM categories WHERE dispatch_station = 'barista'
     AND name IN ('Coffee','Speciale Latte','Special Drinks')),
  3, 'idempotent re-apply leaves 3 barista categories');

SELECT * FROM finish();
ROLLBACK;
