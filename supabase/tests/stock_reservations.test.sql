-- supabase/tests/stock_reservations.test.sql
-- Session 13 / Phase 3.C — pgTAP suite for stock_reservations + reservation RPCs.
--
-- T_RSV_01: stock_reservations table exists
-- T_RSV_02: v_product_available_stock view exists
-- T_RSV_03: reservation_hold_v1 reduces available_quantity
-- T_RSV_04: reservation_release_v1 restores available_quantity
-- T_RSV_05: reservation_hold_v1 with insufficient stock raises insufficient_available_stock
-- T_RSV_06: reservation_hold_v1 idempotent replay returns same id
-- T_RSV_07: release_expired_reservations() flips held->released for expired
-- T_RSV_08: pg_cron job 'release-expired-reservations' is scheduled

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Use a synthetic product so we control current_stock exactly.
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, cost_price)
SELECT 'bbbbbbbb-0000-0000-0000-000000000001'::UUID, 'TEST-RSV-001', 'Reservation test product',
       (SELECT id FROM categories WHERE deleted_at IS NULL LIMIT 1),
       10000, 100, 'pcs', 5000
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001');

UPDATE products SET current_stock = 100 WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- T_RSV_01: table exists
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'stock_reservations',
  'T_RSV_01: stock_reservations table exists');

-- ---------------------------------------------------------------------------
-- T_RSV_02: view exists
-- ---------------------------------------------------------------------------
SELECT has_view('public', 'v_product_available_stock',
  'T_RSV_02: v_product_available_stock view exists');

-- ---------------------------------------------------------------------------
-- T_RSV_03: hold reduces available
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_hold JSONB;
BEGIN
  v_hold := reservation_hold_v1(
    'bbbbbbbb-0000-0000-0000-000000000001'::UUID, 30, 'cart',
    now() + interval '10 minutes'
  );
END $$;

SELECT is(
  (SELECT available_quantity FROM v_product_available_stock
   WHERE product_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  70::numeric,
  'T_RSV_03: holding 30 of 100 reduces available_quantity to 70');

-- ---------------------------------------------------------------------------
-- T_RSV_04: release restores
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_res UUID;
BEGIN
  SELECT id INTO v_res FROM stock_reservations
   WHERE product_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     AND status = 'held'
   LIMIT 1;
  PERFORM reservation_release_v1(v_res, 'test cleanup');
END $$;

SELECT is(
  (SELECT available_quantity FROM v_product_available_stock
   WHERE product_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  100::numeric,
  'T_RSV_04: releasing the hold restores available_quantity to 100');

-- ---------------------------------------------------------------------------
-- T_RSV_05: insufficient stock
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT reservation_hold_v1(
      'bbbbbbbb-0000-0000-0000-000000000001'::UUID, 999, 'cart',
      now() + interval '10 minutes') $$,
  'P0002',
  'insufficient_available_stock',
  'T_RSV_05: insufficient available stock raises insufficient_available_stock');

-- ---------------------------------------------------------------------------
-- T_RSV_06: idempotent replay
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_key UUID := gen_random_uuid();
  v_first  JSONB;
  v_second JSONB;
BEGIN
  v_first := reservation_hold_v1(
    'bbbbbbbb-0000-0000-0000-000000000001'::UUID, 5, 'cart',
    now() + interval '10 minutes', NULL, NULL, NULL, v_key);
  v_second := reservation_hold_v1(
    'bbbbbbbb-0000-0000-0000-000000000001'::UUID, 5, 'cart',
    now() + interval '10 minutes', NULL, NULL, NULL, v_key);
  PERFORM set_config('pgtap.rsv_first_id', v_first->>'reservation_id', false);
  PERFORM set_config('pgtap.rsv_second_id', v_second->>'reservation_id', false);
  PERFORM set_config('pgtap.rsv_second_replay', (v_second->>'idempotent_replay'), false);
END $$;

SELECT ok(
  current_setting('pgtap.rsv_first_id') = current_setting('pgtap.rsv_second_id')
  AND current_setting('pgtap.rsv_second_replay') = 'true',
  'T_RSV_06: same idempotency_key returns same reservation_id with idempotent_replay=true');

-- ---------------------------------------------------------------------------
-- T_RSV_07: release_expired_reservations sweep
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id UUID;
BEGIN
  -- Manually insert an already-expired reservation (cannot via RPC since
  -- expires_at must be future).
  INSERT INTO stock_reservations (product_id, quantity, holder_type, expires_at)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 1, 'cart', now() - interval '1 hour')
  RETURNING id INTO v_id;
  PERFORM release_expired_reservations();
END $$;

SELECT is(
  (SELECT status FROM stock_reservations
   WHERE product_id = 'bbbbbbbb-0000-0000-0000-000000000001'
     AND released_reason = 'expired'
   LIMIT 1),
  'released',
  'T_RSV_07: release_expired_reservations flips expired held rows to released');

-- ---------------------------------------------------------------------------
-- T_RSV_08: cron job scheduled
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'release-expired-reservations'),
  'T_RSV_08: pg_cron job release-expired-reservations is scheduled');

SELECT * FROM finish();
ROLLBACK;
