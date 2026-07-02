-- S53 P1.4 — sale-stock unification acceptance suite.
-- Helper existence/REVOKE + direct helper functional deltas (Task 1);
-- per-RPC regression + new-behavior assertions appended by Tasks 2-4.
--
-- Run via Supabase MCP execute_sql (Docker retired). The suite captures each pgTAP
-- assertion's TAP line into _r and returns (failures, total, lines) — the MCP only
-- echoes the last result row, so a plain finish() would hide mid-suite failures.
BEGIN;
SELECT plan(12);

-- ── Task 1: existence + REVOKE (internal-only helper) ───────────────────────
CREATE TEMP TABLE _r(l text);

INSERT INTO _r SELECT has_function('public', '_record_sale_stock_v1',
  ARRAY['uuid','numeric','uuid','uuid','text','movement_type','text','text','boolean'],
  'T1: _record_sale_stock_v1 exists (9 args)');
INSERT INTO _r SELECT ok(NOT has_function_privilege('anon',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T2: anon EXECUTE revoked');
INSERT INTO _r SELECT ok(NOT has_function_privilege('authenticated',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T3: authenticated EXECUTE revoked');
INSERT INTO _r SELECT ok(NOT has_function_privilege('public',
  '_record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean)', 'EXECUTE'),
  'T4: public EXECUTE revoked');

-- ── Task 1: functional deltas (non-display + display paths) ─────────────────
-- Seed a tracked non-display product and a display product (a trigger auto-creates
-- the display_stock row for is_display_item, so upsert its quantity).
CREATE TEMP TABLE _ids AS
SELECT gen_random_uuid() AS non_disp, gen_random_uuid() AS disp,
       (SELECT id FROM categories LIMIT 1) AS cat,
       (SELECT id FROM user_profiles LIMIT 1) AS prof,
       gen_random_uuid() AS ord;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, is_display_item)
SELECT non_disp, 'S53T1-ND', 'S53 T1 nondisp', cat, 1000, 10, 'pcs', false FROM _ids;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, is_display_item)
SELECT disp, 'S53T1-D', 'S53 T1 disp', cat, 1000, 100, 'pcs', true FROM _ids;
INSERT INTO display_stock (product_id, quantity) SELECT disp, 5 FROM _ids
  ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity;

DO $$ DECLARE r record; BEGIN SELECT * INTO r FROM _ids;
  PERFORM _record_sale_stock_v1(r.non_disp, 3, r.ord, r.prof, 'test nondisp');
  PERFORM _record_sale_stock_v1(r.disp, 2, r.ord, r.prof, 'test disp');
END $$;

INSERT INTO _r SELECT is((SELECT current_stock FROM products WHERE id=(SELECT non_disp FROM _ids)),
  7::numeric, 'T5: non-display current_stock 10-3=7');
INSERT INTO _r SELECT is((SELECT count(*) FROM stock_movements
  WHERE product_id=(SELECT non_disp FROM _ids) AND reference_id=(SELECT ord FROM _ids) AND movement_type='sale'),
  1::bigint, 'T6: one sale stock_movement for the line');
INSERT INTO _r SELECT is((SELECT quantity FROM stock_movements WHERE product_id=(SELECT non_disp FROM _ids) LIMIT 1),
  -3::numeric, 'T7: stock_movement quantity is -3 (magnitude negated)');
INSERT INTO _r SELECT is((SELECT reference_type FROM stock_movements WHERE product_id=(SELECT non_disp FROM _ids) LIMIT 1),
  'orders', 'T8: stock_movements.reference_type stays plural orders');
INSERT INTO _r SELECT is((SELECT quantity FROM display_stock WHERE product_id=(SELECT disp FROM _ids)),
  3::numeric, 'T9: display_stock 5-2=3');
INSERT INTO _r SELECT is((SELECT count(*) FROM display_movements WHERE product_id=(SELECT disp FROM _ids)),
  1::bigint, 'T10: one display_movement for the display line');
INSERT INTO _r SELECT is((SELECT reference_type FROM display_movements WHERE product_id=(SELECT disp FROM _ids) LIMIT 1),
  'order', 'T11: display_movements.reference_type stays singular order');
INSERT INTO _r SELECT is((SELECT movement_type::text FROM display_movements WHERE product_id=(SELECT disp FROM _ids) LIMIT 1),
  'sale', 'T12: display movement_type sale (movement_type->display_movement_type cast works)');

SELECT count(*) FILTER (WHERE l LIKE 'not ok%') AS failures, count(*) AS total, string_agg(l, ' | ') AS lines FROM _r;
ROLLBACK;
