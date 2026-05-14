-- 20260517000043_create_lot_rpcs.sql
-- Session 13 / Phase 1.C — F1 expiry tracking : lot creation + FIFO resolution RPCs.
--
-- This migration creates :
--   1. `create_stock_lot_v1(...)` — SECURITY DEFINER public RPC, gated by
--      `inventory.receive`. Called UPFRONT at receive time (PO receive Phase 3.A,
--      production_record Phase 2.A, BO manual entry).
--   2. `_resolve_fifo_lot(p_product_id, p_quantity_needed)` — internal helper
--      consumed by `record_stock_movement_v1` (extended Phase 1.A 000020).
--
-- B1 PATTERN (locked D15) : NO AFTER INSERT trigger on `stock_movements`.
-- FIFO selection happens UPFRONT inside the SECURITY DEFINER caller, *before*
-- the ledger row is inserted, so `lot_id` lands populated at INSERT time.
--
-- T_F1_NO_TRIGGER_INVARIANT pins this : `SELECT COUNT(*) FROM pg_trigger
--   WHERE tgrelid = 'stock_movements'::regclass AND tgenabled = 'O'
--     AND tgname ~* '(fifo|consume|lot)' = 0`.

-- ──────────────────────────────────────────────────────────────────────────────
-- create_stock_lot_v1 — public RPC, gated by inventory.receive.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_stock_lot_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_unit            TEXT           DEFAULT NULL,
  p_location_id     UUID           DEFAULT NULL,
  p_expires_at      TIMESTAMPTZ    DEFAULT NULL,
  p_batch_number    TEXT           DEFAULT NULL,
  p_idempotency_key UUID           DEFAULT NULL,
  p_metadata        JSONB          DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile          UUID;
  v_lot_id           UUID;
  v_unit             TEXT;
  v_shelf_life_hours INT;
  v_expires_at       TIMESTAMPTZ;
  v_product_unit     TEXT;
BEGIN
  -- Permission gate (RPC is public — caller is authenticated user).
  IF NOT has_permission(v_uid, 'inventory.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
  END IF;

  -- Idempotency replay : same key → return the existing row, do NOT INSERT.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_lot_id FROM stock_lots WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'lot_id',            v_lot_id,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- Resolve actor profile.
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Resolve product : unit + default_shelf_life_hours.
  SELECT unit, default_shelf_life_hours
    INTO v_product_unit, v_shelf_life_hours
    FROM products
    WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  -- Unit resolution : caller wins, else product, else 'pcs' (UNIT-FIX rule).
  v_unit := COALESCE(p_unit, v_product_unit, 'pcs');

  -- Expiry resolution : caller wins ; else products.default_shelf_life_hours ;
  -- else raise — can't track a lot with no expiry.
  IF p_expires_at IS NOT NULL THEN
    v_expires_at := p_expires_at;
  ELSIF v_shelf_life_hours IS NOT NULL THEN
    v_expires_at := now() + (v_shelf_life_hours * INTERVAL '1 hour');
  ELSE
    RAISE EXCEPTION 'expires_at_required' USING ERRCODE='P0001';
  END IF;

  -- Future-only guard : refuse already-expired lots (would never be FIFO-eligible).
  IF v_expires_at <= now() THEN
    RAISE EXCEPTION 'expires_at_must_be_future' USING ERRCODE='P0001';
  END IF;

  INSERT INTO stock_lots (
    product_id, location_id, quantity, unit,
    expires_at, batch_number, idempotency_key, metadata
  ) VALUES (
    p_product_id, p_location_id, p_quantity, v_unit,
    v_expires_at, p_batch_number, p_idempotency_key, COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING id INTO v_lot_id;

  -- Audit trail (matches stock_movements audit_log pattern).
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'stock_lot.create', 'stock_lots', v_lot_id,
    jsonb_build_object(
      'product_id',     p_product_id,
      'quantity',       p_quantity,
      'unit',           v_unit,
      'expires_at',     v_expires_at,
      'batch_number',   p_batch_number,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'lot_id',            v_lot_id,
    'expires_at',        v_expires_at,
    'idempotent_replay', false
  );
END $$;

GRANT EXECUTE ON FUNCTION create_stock_lot_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION create_stock_lot_v1 FROM anon;

COMMENT ON FUNCTION create_stock_lot_v1 IS
  'Session 13 — F1. SECURITY DEFINER public RPC. Creates a stock_lots row at '
  'receive time (PO / production / manual). Gated by inventory.receive. '
  'Idempotent via p_idempotency_key. Defaults expires_at from '
  'products.default_shelf_life_hours when not supplied.';

-- ──────────────────────────────────────────────────────────────────────────────
-- _resolve_fifo_lot — internal helper, consumed by record_stock_movement_v1.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _resolve_fifo_lot(
  p_product_id      UUID,
  p_quantity_needed DECIMAL(10,3)
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lot_id UUID;
  v_qty    DECIMAL(10,3);
BEGIN
  -- Defensive : a zero or negative qty makes no sense for FIFO consumption.
  IF p_quantity_needed IS NULL OR p_quantity_needed <= 0 THEN
    RETURN NULL;
  END IF;

  -- FIFO by expires_at ASC, then received_at ASC, then id ASC (deterministic).
  -- FOR UPDATE locks the lot row so the concurrent consumer doesn't double-spend.
  SELECT id, quantity INTO v_lot_id, v_qty
    FROM stock_lots
    WHERE product_id = p_product_id
      AND status = 'active'
      AND quantity > 0
    ORDER BY expires_at ASC, received_at ASC, id ASC
    LIMIT 1
    FOR UPDATE;

  -- No eligible lot → caller falls back to non-lot path (lot_id stays NULL on insert).
  -- This is intentional : not every product is under F1, and a sale of a
  -- non-tracked product still goes through record_stock_movement_v1.
  IF v_lot_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Insufficient quantity on FIFO head → MVP refuses to split.
  -- Caller (record_stock_movement_v1) raises insufficient_stock to surface this.
  IF v_qty < p_quantity_needed THEN
    RAISE EXCEPTION 'insufficient_lot_quantity'
      USING ERRCODE='P0002', DETAIL=format('lot=%s remaining=%s needed=%s', v_lot_id, v_qty, p_quantity_needed);
  END IF;

  RETURN v_lot_id;
END $$;

REVOKE EXECUTE ON FUNCTION _resolve_fifo_lot FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _resolve_fifo_lot FROM authenticated;
REVOKE EXECUTE ON FUNCTION _resolve_fifo_lot FROM anon;

COMMENT ON FUNCTION _resolve_fifo_lot IS
  'Session 13 — F1. INTERNAL helper. Called by record_stock_movement_v1 when '
  'caller passes p_lot_id IS NULL on a consuming movement. Returns the FIFO '
  'lot (earliest expires_at first) with FOR UPDATE lock. Returns NULL when '
  'product is not under F1 tracking. Raises insufficient_lot_quantity when '
  'FIFO head cannot satisfy the requested quantity (no auto-split in MVP).';
