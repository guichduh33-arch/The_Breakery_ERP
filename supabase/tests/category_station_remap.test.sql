-- supabase/tests/category_station_remap.test.sql
-- Session 34 — verify the category → prep-station remap (migration 20260601043059).
-- Run via MCP execute_sql wrapped in BEGIN ... ROLLBACK (Docker retired).
--   T1  : categories route to the expected prep station vocabulary
--   T2  : the remap is idempotent (re-running the UPDATEs changes nothing)
--   T3  : no active sellable product is left on dispatch_station='none'
BEGIN;
SELECT plan(7);

-- T1 — mapping per category (post-migration steady state)
SELECT is(
  (SELECT dispatch_station FROM categories WHERE lower(name) = 'beverage'),
  'barista', 'T1a Beverage routes to barista');
SELECT is(
  (SELECT dispatch_station FROM categories WHERE lower(name) = 'sandwiches'),
  'kitchen', 'T1b Sandwiches routes to kitchen');
SELECT is(
  (SELECT count(*)::int FROM categories
     WHERE lower(name) IN ('viennoiserie','bagel','pastry','bread')
       AND dispatch_station = 'bakery'),
  4, 'T1c all four bakery categories route to bakery');
SELECT is(
  (SELECT count(*)::int FROM categories
     WHERE lower(name) IN ('plate','savoury') AND dispatch_station = 'kitchen'),
  2, 'T1d Plate/Savoury remain kitchen');

-- T2 — idempotence: re-apply the migration UPDATEs, expect 0 rows changed
WITH reapply AS (
  UPDATE categories SET dispatch_station = 'barista'
    WHERE lower(name) = 'beverage' AND dispatch_station IS DISTINCT FROM 'barista'
  RETURNING 1
), reapply2 AS (
  UPDATE categories SET dispatch_station = 'kitchen'
    WHERE lower(name) = 'sandwiches' AND dispatch_station IS DISTINCT FROM 'kitchen'
  RETURNING 1
), reapply3 AS (
  UPDATE categories SET dispatch_station = 'bakery'
    WHERE lower(name) IN ('pastry','bread') AND dispatch_station IS DISTINCT FROM 'bakery'
  RETURNING 1
)
SELECT is(
  (SELECT (SELECT count(*) FROM reapply) + (SELECT count(*) FROM reapply2) + (SELECT count(*) FROM reapply3))::int,
  0, 'T2 remap is idempotent (no rows change on re-run)');

-- T3 — no active sellable product stranded on 'none'
SELECT is(
  (SELECT count(*)::int FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true AND c.dispatch_station = 'none'),
  0, 'T3 no active product routes to none');

-- T4 — every active product routes to a real prep station (defense-in-depth)
SELECT is(
  (SELECT count(*)::int FROM products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true
       AND c.dispatch_station NOT IN ('barista','kitchen','bakery')),
  0, 'T4 all active products route to barista/kitchen/bakery');

SELECT * FROM finish();
ROLLBACK;
