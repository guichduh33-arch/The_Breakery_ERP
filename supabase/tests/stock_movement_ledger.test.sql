-- supabase/tests/stock_movement_ledger.test.sql
-- pgTAP for get_stock_movement_ledger_v1 (2026-06-18 stock-card ledger).
-- Run via MCP execute_sql inside a BEGIN/ROLLBACK envelope (Docker retired).
--
-- Covers: auth + permission gate (deny / inventory.read / reports.inventory.read OR-branch),
-- per-product running balance seeded by opening, incoming/outgoing split, price +
-- movement_amount + product_group, truncated flag, REVOKE (anon cannot execute).

BEGIN;
SELECT plan(16);

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- A brand-new product (no prior movements) → deterministic opening balance.
INSERT INTO products (id, sku, name, category_id, retail_price, cost_price, unit, is_active)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'TST-LEDGER', 'ZZ Ledger Test',
  (SELECT id FROM categories ORDER BY name LIMIT 1),
  1000, 100, 'kg', true
);

-- Pre-range opening: +10 before p_start (2099-06-01). sale rows carry a reference_id
-- (chk_stock_movements_reference_required_for_orders).
INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, reason, created_by, created_at, metadata)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'purchase', 10, 'kg', 'admin_action', NULL,                'seed opening', '00000000-0000-0000-0000-000000000001', '2099-01-01T00:00:00Z', '{}'),
-- In-range: sale -3, purchase +5, sale -2  → balances 7, 12, 10
  ('11111111-1111-1111-1111-111111111111', 'sale',     -3, 'kg', 'orders',       gen_random_uuid(),   NULL,           '00000000-0000-0000-0000-000000000001', '2099-06-01T08:00:00Z', '{}'),
  ('11111111-1111-1111-1111-111111111111', 'purchase',  5, 'kg', 'admin_action', NULL,                'restock',      '00000000-0000-0000-0000-000000000001', '2099-06-01T09:00:00Z', '{}'),
  ('11111111-1111-1111-1111-111111111111', 'sale',     -2, 'kg', 'orders',       gen_random_uuid(),   NULL,           '00000000-0000-0000-0000-000000000001', '2099-06-01T10:00:00Z', '{}');

-- ── T1: auth required ────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{}', true);
SELECT throws_ok(
  $$ SELECT get_stock_movement_ledger_v1('2099-06-01','2099-06-30') $$,
  '42501', NULL, 'T1 no auth → 42501');

-- ── T2: no permission (cashier) ──────────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT get_stock_movement_ledger_v1('2099-06-01','2099-06-30') $$,
  '42501', NULL, 'T2 cashier (no perm) → 42501');

-- ── T3-T12: owner (inventory.read) ───────────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

SELECT lives_ok(
  $$ SELECT get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111') $$,
  'T3 owner can execute');

SELECT is(
  (get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->>'row_count'),
  '3', 'T4 row_count = 3');

SELECT is(
  ((get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->0->>'beginning_qty')::numeric),
  10::numeric, 'T5 line0 beginning_qty = opening 10');

SELECT is(
  ((get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->0->>'outgoing_qty')::numeric),
  3::numeric, 'T6 line0 outgoing_qty = 3');

SELECT is(
  ((get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->0->>'balance_qty')::numeric),
  7::numeric, 'T7 line0 balance_qty = 7');

SELECT is(
  ((get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->0->>'movement_amount')::numeric),
  -300::numeric, 'T8 line0 movement_amount = -300');

SELECT is(
  (get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->0->>'product_group'),
  (SELECT name FROM categories ORDER BY name LIMIT 1), 'T9 product_group = category name');

SELECT is(
  ((get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->0->>'price')::numeric),
  100::numeric, 'T10 line0 price = cost_price 100');

SELECT is(
  ((get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->1->>'incoming_qty')::numeric),
  5::numeric, 'T11 line1 incoming_qty = 5');

SELECT is(
  ((get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111')->'lines'->2->>'balance_qty')::numeric),
  10::numeric, 'T12 line2 balance_qty = 10');

-- ── T13-T14: truncation guard ────────────────────────────────────────────────
SELECT is(
  (get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111', NULL, NULL, 1)->>'truncated'),
  'true', 'T13 truncated=true when limit exceeded');
SELECT is(
  (get_stock_movement_ledger_v1('2099-06-01','2099-06-30','11111111-1111-1111-1111-111111111111', NULL, NULL, 1)->>'row_count'),
  '1', 'T14 row_count clamped to limit 1');

-- ── T15: REVOKE — anon cannot execute ────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon',
    'get_stock_movement_ledger_v1(text,text,uuid,text,uuid,int)', 'EXECUTE'),
  'T15 anon cannot execute');

-- ── T16: reports.inventory.read-only OR-branch passes ────────────────────────
INSERT INTO user_permission_overrides (user_profile_id, permission_code, is_granted, reason)
VALUES ('00000000-0000-0000-0000-000000000002', 'reports.inventory.read', true, 'pgtap');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT get_stock_movement_ledger_v1('2099-06-01','2099-06-30') $$,
  'T16 reports.inventory.read-only user can execute');

SELECT * FROM finish();
ROLLBACK;
