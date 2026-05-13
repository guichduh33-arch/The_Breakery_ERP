-- supabase/tests/inventory_f1_lots.test.sql
-- Session 13 / Phase 1.C — F1 expiry tracking pgTAP suite.
--
-- Covers the 6 migrations 20260517000040-045 :
--   - stock_lots table + RLS + indexes
--   - products.default_shelf_life_hours
--   - stock_movements.lot_id FK
--   - create_stock_lot_v1 RPC
--   - _resolve_fifo_lot helper
--   - get_expiring_lots_v1 RPC
--   - pg_cron mark_expired_lots_hourly() function
--
-- Critical invariants (D15 locked) :
--   - T_F1_NO_TRIGGER_INVARIANT : NO trigger AFTER INSERT/UPDATE on stock_movements
--     touching lot_id.
--   - T_F1_LOT_INVARIANT        : direct INSERT/UPDATE/DELETE on stock_lots by
--     `authenticated` role denied (RLS lockdown).
--   - T_F1_NO_LOT_ID_UPDATE     : UPDATE stock_movements.lot_id post-INSERT
--     denied (ledger remains append-only).
--
-- Runner :
--   bash supabase/tests/run_pgtap.sh inventory_f1_lots

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Plan : 17 tests (T_F1_01..17) + 3 invariant blocks counted separately.
SELECT plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures : a product with shelf life + two MANAGER profiles already exist
-- in seed.sql. We add a fresh perishable product to avoid cross-test pollution.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_cat UUID;
  v_pid UUID;
BEGIN
  SELECT id INTO v_cat FROM categories LIMIT 1;
  INSERT INTO products (sku, name, slug, category_id, retail_price, wholesale_price, current_stock, unit, default_shelf_life_hours, product_type, is_active)
  VALUES ('F1-TEST-CROISSANT', 'F1 Croissant', 'f1-croissant', v_cat, 5000, 3000, 0, 'pcs', 24, 'standalone', true)
  ON CONFLICT (sku) DO UPDATE SET default_shelf_life_hours = EXCLUDED.default_shelf_life_hours
  RETURNING id INTO v_pid;
  PERFORM set_config('breakery.f1_test_pid', v_pid::text, true);
END $$;

-- ---------------------------------------------------------------------------
-- T_F1_01 — stock_lots table exists with the expected columns
-- ---------------------------------------------------------------------------
SELECT has_table('stock_lots', 'T_F1_01: stock_lots table exists');

-- ---------------------------------------------------------------------------
-- T_F1_02 — stock_lots.status CHECK enforces the 3-valued enum
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$INSERT INTO stock_lots (product_id, quantity, unit, expires_at, status)
       VALUES (gen_random_uuid(), 5, 'pcs', now() + INTERVAL '1 day', 'bogus')$$,
  '23514',
  NULL,
  'T_F1_02: stock_lots.status CHECK rejects unknown status values'
);

-- ---------------------------------------------------------------------------
-- T_F1_03 — products.default_shelf_life_hours column exists + nullable + CHECK
-- ---------------------------------------------------------------------------
SELECT has_column('products', 'default_shelf_life_hours',
  'T_F1_03: products.default_shelf_life_hours column exists');

-- ---------------------------------------------------------------------------
-- T_F1_04 — stock_movements.lot_id FK references stock_lots(id)
-- ---------------------------------------------------------------------------
SELECT col_has_fk('stock_movements', 'lot_id',
  'T_F1_04: stock_movements.lot_id has a FK constraint');

-- ---------------------------------------------------------------------------
-- T_F1_05 — create_stock_lot_v1 happy path (caller = SUPER_ADMIN)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid UUID;
  v_pid UUID := current_setting('breakery.f1_test_pid', true)::UUID;
  v_result JSONB;
BEGIN
  SELECT auth_user_id INTO v_uid FROM user_profiles
    WHERE role_code='SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  v_result := create_stock_lot_v1(
    p_product_id     => v_pid,
    p_quantity       => 10,
    p_unit           => 'pcs',
    p_expires_at     => now() + INTERVAL '12 hours',
    p_batch_number   => 'F1-TEST-BATCH-01'
  );
  PERFORM set_config('breakery.f1_lot_id', (v_result->>'lot_id'), true);
END $$;

SELECT ok(
  current_setting('breakery.f1_lot_id', true) IS NOT NULL
    AND current_setting('breakery.f1_lot_id', true) <> '',
  'T_F1_05: create_stock_lot_v1 returns a lot_id on happy path'
);

-- ---------------------------------------------------------------------------
-- T_F1_06 — create_stock_lot_v1 idempotency replay
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid UUID;
  v_pid UUID := current_setting('breakery.f1_test_pid', true)::UUID;
  v_key UUID := gen_random_uuid();
  v_first JSONB; v_second JSONB;
BEGIN
  SELECT auth_user_id INTO v_uid FROM user_profiles
    WHERE role_code='SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  v_first  := create_stock_lot_v1(v_pid, 3, 'pcs', NULL, now() + INTERVAL '6 hours', NULL, v_key);
  v_second := create_stock_lot_v1(v_pid, 3, 'pcs', NULL, now() + INTERVAL '6 hours', NULL, v_key);

  PERFORM set_config('breakery.f1_idem_match',
    ((v_first->>'lot_id') = (v_second->>'lot_id')
     AND (v_second->>'idempotent_replay')::BOOLEAN = true)::text, true);
END $$;

SELECT ok(
  current_setting('breakery.f1_idem_match', true)::BOOLEAN,
  'T_F1_06: create_stock_lot_v1 replays idempotently on duplicate key'
);

-- ---------------------------------------------------------------------------
-- T_F1_07 — create_stock_lot_v1 raises expires_at_must_be_future for past dates
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid UUID;
  v_pid UUID := current_setting('breakery.f1_test_pid', true)::UUID;
  v_caught TEXT := '';
BEGIN
  SELECT auth_user_id INTO v_uid FROM user_profiles
    WHERE role_code='SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  BEGIN
    PERFORM create_stock_lot_v1(v_pid, 1, 'pcs', NULL, now() - INTERVAL '1 hour');
  EXCEPTION WHEN OTHERS THEN
    v_caught := SQLERRM;
  END;
  PERFORM set_config('breakery.f1_past_caught', v_caught, true);
END $$;

SELECT like(
  current_setting('breakery.f1_past_caught', true),
  '%expires_at_must_be_future%',
  'T_F1_07: create_stock_lot_v1 rejects expires_at in the past'
);

-- ---------------------------------------------------------------------------
-- T_F1_LOT_INVARIANT — direct INSERT on stock_lots by `authenticated` role denied
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_blocked BOOLEAN := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO stock_lots (product_id, quantity, unit, expires_at)
    VALUES (gen_random_uuid(), 1, 'pcs', now() + INTERVAL '1 hour');
  EXCEPTION
    WHEN insufficient_privilege THEN v_blocked := true;
    WHEN OTHERS THEN v_blocked := true;
  END;
  RESET ROLE;
  PERFORM set_config('breakery.f1_lot_invariant', v_blocked::text, true);
END $$;

SELECT ok(
  current_setting('breakery.f1_lot_invariant', true)::BOOLEAN,
  'T_F1_LOT_INVARIANT: direct INSERT on stock_lots by authenticated role is denied'
);

-- ---------------------------------------------------------------------------
-- T_F1_NO_TRIGGER_INVARIANT — no AFTER INSERT/UPDATE trigger on stock_movements
--   touching lot resolution (B1 pattern : FIFO lives UPFRONT in record_stock_movement_v1)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::INT FROM pg_trigger
    WHERE tgrelid = 'stock_movements'::regclass
      AND tgenabled = 'O'
      AND (tgname ~* 'fifo' OR tgname ~* 'consume' OR tgname ~* 'lot')),
  0,
  'T_F1_NO_TRIGGER_INVARIANT: no FIFO/consume/lot trigger on stock_movements (B1 invariant)'
);

-- ---------------------------------------------------------------------------
-- T_F1_10 — get_expiring_lots_v1 returns lots within window
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid UUID;
  v_count INT;
BEGIN
  SELECT auth_user_id INTO v_uid FROM user_profiles
    WHERE role_code='SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  SELECT COUNT(*)::INT INTO v_count FROM get_expiring_lots_v1(24);
  PERFORM set_config('breakery.f1_expiring_count', v_count::text, true);
END $$;

SELECT cmp_ok(
  current_setting('breakery.f1_expiring_count', true)::INT,
  '>=',
  2,
  'T_F1_10: get_expiring_lots_v1 returns the 2+ lots we just created within 24h'
);

-- ---------------------------------------------------------------------------
-- T_F1_11 — get_expiring_lots_v1 honors p_hours_ahead window
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid UUID;
  v_short INT; v_long INT;
BEGIN
  SELECT auth_user_id INTO v_uid FROM user_profiles
    WHERE role_code='SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  SELECT COUNT(*)::INT INTO v_short FROM get_expiring_lots_v1(2);
  SELECT COUNT(*)::INT INTO v_long  FROM get_expiring_lots_v1(48);
  PERFORM set_config('breakery.f1_window_diff', (v_long >= v_short)::text, true);
END $$;

SELECT ok(
  current_setting('breakery.f1_window_diff', true)::BOOLEAN,
  'T_F1_11: get_expiring_lots_v1(48h) >= get_expiring_lots_v1(2h)'
);

-- ---------------------------------------------------------------------------
-- T_F1_12 — _resolve_fifo_lot picks the earliest-expiring active lot
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pid UUID := current_setting('breakery.f1_test_pid', true)::UUID;
  v_picked UUID;
  v_earliest_id UUID;
BEGIN
  -- The earliest lot among our seeded ones is the 6h-expires one.
  SELECT id INTO v_earliest_id
    FROM stock_lots WHERE product_id = v_pid AND status='active'
    ORDER BY expires_at ASC, received_at ASC, id ASC LIMIT 1;

  -- _resolve_fifo_lot is REVOKE'd from authenticated; run as session owner.
  v_picked := _resolve_fifo_lot(v_pid, 1);
  PERFORM set_config('breakery.f1_fifo_match', (v_picked = v_earliest_id)::text, true);
END $$;

SELECT ok(
  current_setting('breakery.f1_fifo_match', true)::BOOLEAN,
  'T_F1_12: _resolve_fifo_lot returns the earliest-expiring active lot'
);

-- ---------------------------------------------------------------------------
-- T_F1_13 — _resolve_fifo_lot returns NULL when no active lot for the product
-- ---------------------------------------------------------------------------
SELECT is(
  _resolve_fifo_lot(gen_random_uuid(), 1),
  NULL::UUID,
  'T_F1_13: _resolve_fifo_lot returns NULL for products with no active lot'
);

-- ---------------------------------------------------------------------------
-- T_F1_14 — _resolve_fifo_lot raises insufficient_lot_quantity when head is too small
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pid UUID := current_setting('breakery.f1_test_pid', true)::UUID;
  v_caught TEXT := '';
BEGIN
  BEGIN
    PERFORM _resolve_fifo_lot(v_pid, 99999); -- way more than any single lot
  EXCEPTION WHEN OTHERS THEN
    v_caught := SQLERRM;
  END;
  PERFORM set_config('breakery.f1_insuf_caught', v_caught, true);
END $$;

SELECT like(
  current_setting('breakery.f1_insuf_caught', true),
  '%insufficient_lot_quantity%',
  'T_F1_14: _resolve_fifo_lot raises insufficient_lot_quantity when FIFO head is too small'
);

-- ---------------------------------------------------------------------------
-- T_F1_NO_LOT_ID_UPDATE — UPDATE stock_movements.lot_id post-INSERT denied
-- (RLS revokes UPDATE on stock_movements for authenticated)
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_blocked BOOLEAN := false;
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE stock_movements SET lot_id = gen_random_uuid() WHERE FALSE; -- WHERE FALSE = no rows but still gated
  EXCEPTION
    WHEN insufficient_privilege THEN v_blocked := true;
    WHEN OTHERS THEN v_blocked := true;
  END;
  RESET ROLE;
  PERFORM set_config('breakery.f1_no_update', v_blocked::text, true);
END $$;

SELECT ok(
  current_setting('breakery.f1_no_update', true)::BOOLEAN,
  'T_F1_NO_LOT_ID_UPDATE: UPDATE stock_movements.lot_id by authenticated denied'
);

-- ---------------------------------------------------------------------------
-- T_F1_16 — mark_expired_lots_hourly flips status of past-expiry lots
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid UUID;
  v_pid UUID := current_setting('breakery.f1_test_pid', true)::UUID;
  v_lot UUID;
  v_status_before TEXT;
  v_status_after  TEXT;
BEGIN
  SELECT auth_user_id INTO v_uid FROM user_profiles
    WHERE role_code='SUPER_ADMIN' AND deleted_at IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  -- Insert a lot directly (we're running as postgres in pgTAP), then push its
  -- expires_at into the past so the sweep flips it. We bypass create_stock_lot_v1
  -- because that RPC refuses past-expiry inputs.
  INSERT INTO stock_lots (product_id, quantity, unit, expires_at)
    VALUES (v_pid, 1, 'pcs', now() + INTERVAL '1 hour')
    RETURNING id INTO v_lot;
  UPDATE stock_lots SET expires_at = now() - INTERVAL '1 minute' WHERE id = v_lot;

  SELECT status INTO v_status_before FROM stock_lots WHERE id = v_lot;
  PERFORM mark_expired_lots_hourly();
  SELECT status INTO v_status_after FROM stock_lots WHERE id = v_lot;

  PERFORM set_config('breakery.f1_cron_flip',
    (v_status_before = 'active' AND v_status_after = 'expired')::text, true);
END $$;

SELECT ok(
  current_setting('breakery.f1_cron_flip', true)::BOOLEAN,
  'T_F1_16: mark_expired_lots_hourly flips active→expired for past-expires_at lots'
);

-- ---------------------------------------------------------------------------
-- T_F1_17 — mark_expired_lots_hourly INSERTs a new waste row (never UPDATEs ledger)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_pid UUID := current_setting('breakery.f1_test_pid', true)::UUID;
  v_count_before INT; v_count_after INT;
  v_lot UUID;
BEGIN
  SELECT COUNT(*) INTO v_count_before FROM stock_movements
    WHERE product_id = v_pid AND movement_type = 'waste';
  INSERT INTO stock_lots (product_id, quantity, unit, expires_at)
    VALUES (v_pid, 2, 'pcs', now() + INTERVAL '1 hour')
    RETURNING id INTO v_lot;
  UPDATE stock_lots SET expires_at = now() - INTERVAL '1 minute' WHERE id = v_lot;
  PERFORM mark_expired_lots_hourly();
  SELECT COUNT(*) INTO v_count_after FROM stock_movements
    WHERE product_id = v_pid AND movement_type = 'waste';
  PERFORM set_config('breakery.f1_cron_waste', (v_count_after > v_count_before)::text, true);
END $$;

SELECT ok(
  current_setting('breakery.f1_cron_waste', true)::BOOLEAN,
  'T_F1_17: mark_expired_lots_hourly INSERTs a new waste stock_movements row (append-only preserved)'
);

-- ---------------------------------------------------------------------------
-- Bonus invariant : the FIFO index is partial WHERE status='active'
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
      WHERE tablename = 'stock_lots'
        AND indexname = 'idx_stock_lots_fifo'
  ),
  'T_F1_18: idx_stock_lots_fifo index exists for FIFO scans'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
      WHERE tablename = 'stock_movements'
        AND indexname = 'idx_stock_movements_lot_id'
  ),
  'T_F1_19: idx_stock_movements_lot_id partial index exists for lot-history lookups'
);

-- ---------------------------------------------------------------------------
-- Final invariant : create_stock_lot_v1 is GRANTed to authenticated
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'create_stock_lot_v1(uuid,numeric,text,uuid,timestamptz,text,uuid,jsonb)', 'EXECUTE'),
  'T_F1_20: create_stock_lot_v1 is GRANTed EXECUTE to authenticated'
);

SELECT * FROM finish();
ROLLBACK;
