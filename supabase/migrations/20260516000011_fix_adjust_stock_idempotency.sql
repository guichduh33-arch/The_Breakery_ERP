-- 20260516000011_fix_adjust_stock_idempotency.sql
-- Session 12 / hotfix : adjust_stock_v1 idempotency replay bug.
--
-- Bug (discovered by pgTAP T4 in supabase/tests/inventory.test.sql):
--   adjust_stock_v1 computes `v_delta = p_new_qty - current_stock` BEFORE
--   checking idempotency, then short-circuits via `noop=true` when delta=0.
--   On a retry with the same idempotency_key, the row has already been
--   updated to p_new_qty, so delta=0 and the RPC returns
--   `{movement_id: null, noop: true}` instead of replaying the original
--   movement_id. This breaks the contract documented in the modal
--   (AdjustModal generates `crypto.randomUUID()` at mount and reuses it on
--   submit retries) — the second click returns NULL where the first
--   returned a UUID, and the audit/history trail is misleading.
--
-- Fix: check idempotency_key at the top of adjust_stock_v1, before reading
-- the current stock. If a matching row exists, replay the recorded result.
-- This mirrors the pattern in record_stock_movement_v1 (which also checks
-- first) and matches the receive/waste idempotency semantics.

CREATE OR REPLACE FUNCTION adjust_stock_v1(
  p_product_id      UUID,
  p_new_qty         DECIMAL(10,3),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current DECIMAL(10,3);
  v_delta   DECIMAL(10,3);
  v_existing_mvt UUID;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.adjust') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_new_qty < 0 THEN
    RAISE EXCEPTION 'negative_qty_not_allowed';
  END IF;

  -- Idempotency replay: if a movement with this key exists, return it as-is.
  -- Done BEFORE the FOR UPDATE lock so retries are cheap and don't contend
  -- with a concurrent transaction touching the same product row.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_mvt
      FROM stock_movements
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_current FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'movement_id',       v_existing_mvt,
        'product_id',        p_product_id,
        'new_current_stock', v_current,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_delta := p_new_qty - v_current;
  IF v_delta = 0 THEN
    -- No-op when the stock already matches the target. Idempotency_key is
    -- NOT persisted in this case — a subsequent retry with the same key will
    -- still resolve to noop (because no row was inserted).
    RETURN jsonb_build_object(
      'movement_id',       NULL,
      'product_id',        p_product_id,
      'new_current_stock', v_current,
      'noop',              true
    );
  END IF;

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'adjustment',
    p_quantity        := v_delta,
    p_reason          := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $$;

COMMENT ON FUNCTION adjust_stock_v1 IS
  'ADMIN+. Set product stock to p_new_qty. Computes signed delta and records an "adjustment" movement. '
  'v2 (session 12 hotfix): idempotency_key is now checked BEFORE delta computation so a retry '
  'returns {movement_id, idempotent_replay=true} instead of a misleading noop.';
