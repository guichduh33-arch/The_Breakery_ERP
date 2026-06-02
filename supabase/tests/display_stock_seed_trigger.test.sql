-- supabase/tests/display_stock_seed_trigger.test.sql
-- pgTAP — M7 audit fix : trigger `tr_seed_display_stock` seeds a display_stock(id,0)
-- row when a product is flagged is_display_item, WITHOUT ever resetting an
-- already-stocked counter. Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(5);

-- Fixture: a product created already flagged as a display item.
INSERT INTO products (id, name, sku, category_id, retail_price, unit, is_display_item)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'M7 Flagged At Create', 'M7-CREATE-1',
        (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1), 1000, 'pcs', true);

-- T1 : creating a product flagged is_display_item seeds a display_stock row at 0.
SELECT is(
  (SELECT quantity FROM display_stock WHERE product_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::numeric(10,3),
  'T1 create flagged → display_stock seeded at 0');

-- Fixture: a standalone non-display product.
INSERT INTO products (id, name, sku, category_id, retail_price, unit, is_display_item)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'M7 Toggle Later', 'M7-TOGGLE-2',
        (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1), 1000, 'pcs', false);

-- T2 : a non-display product has NO display_stock row.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM display_stock WHERE product_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'T2 non-display product → no display_stock row');

-- T3 : flagging an existing product false→true seeds the row at 0.
UPDATE products SET is_display_item = true WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
SELECT is(
  (SELECT quantity FROM display_stock WHERE product_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0::numeric(10,3),
  'T3 toggle false→true → display_stock seeded at 0');

-- T4 : re-flagging an already-stocked vitrine NEVER resets the counter.
UPDATE display_stock SET quantity = 50 WHERE product_id = 'aaaaaaaa-0000-0000-0000-000000000002';
UPDATE products SET is_display_item = true WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
SELECT is(
  (SELECT quantity FROM display_stock WHERE product_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  50::numeric(10,3),
  'T4 re-flag preserves a stocked counter (ON CONFLICT DO NOTHING)');

-- T5 : backfill invariant — every is_display_item=true product has a display_stock row.
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM products p
    LEFT JOIN display_stock ds ON ds.product_id = p.id
    WHERE p.is_display_item = true AND ds.product_id IS NULL),
  'T5 backfill invariant — no flagged product lacks a display_stock row');

SELECT * FROM finish();
ROLLBACK;
