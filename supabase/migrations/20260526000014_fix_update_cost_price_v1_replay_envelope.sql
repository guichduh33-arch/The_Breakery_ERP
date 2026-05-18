-- 20260526000014_fix_update_cost_price_v1_replay_envelope.sql
-- Session 22 / Phase 1.B.1 — quality reviewer follow-up.
--
-- Empirical finding : the idempotent-replay branch of update_cost_price_v1
-- (introduced by 20260526000012, lines 118..131) returns an envelope that is
-- missing the `old_cost` key — diverging from the fresh-path envelope shape :
--
--   Fresh path returns :
--     { movement_id, product_id, old_cost, new_cost, idempotent_replay: false }
--   Replay path returns (PRE-FIX) :
--     { movement_id, product_id,           new_cost, idempotent_replay: true  }
--
-- Downstream consumers calling the RPC and getting a replay get a different
-- shape than fresh-path success, breaking response-typing contracts.
--
-- Fix : in the replay branch, reconstruct `old_cost` from the existing
-- stock_movements.metadata->>'old_cost' field (it was persisted there by the
-- fresh path on first call — see metadata jsonb_build_object in 000012). Cast
-- to NUMERIC and add to the returned jsonb so the envelope matches.
--
-- Scope discipline : this migration only touches the replay-IF block. The
-- fresh-path body, validation, permission check, error codes, GRANTs, and
-- COMMENT are reissued verbatim from 000012. CREATE OR REPLACE preserves
-- grants but project convention is to re-issue them for safety.
--
-- NOTE: idempotent replay does NOT validate p_product_id matches the stored
-- movement's product_id — this mirrors record_stock_movement_v1's convention
-- (project-wide). If a caller re-uses an idempotency_key across different
-- products, they get a misleading envelope. Tracked as DEV-S22-1.B-08 in
-- INDEX §10 (informational, out of scope for this fix).

CREATE OR REPLACE FUNCTION update_cost_price_v1(
  p_product_id      UUID,
  p_new_cost        DECIMAL(14,2),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile          UUID;
  v_old_cost         DECIMAL(14,2);
  v_unit             TEXT;
  v_mvt_id           UUID;
  v_replay_old_cost  NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0003';
  END IF;

  IF NOT has_permission(v_uid, 'inventory.cost_correction') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_new_cost IS NULL OR p_new_cost < 0 THEN
    RAISE EXCEPTION 'invalid_cost' USING ERRCODE='P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL
    LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    -- Reconstruct old_cost from the persisted metadata on the original movement
    -- row so the replay envelope matches the fresh-path shape.
    SELECT id, (metadata->>'old_cost')::NUMERIC
      INTO v_mvt_id, v_replay_old_cost
      FROM stock_movements
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT cost_price INTO v_old_cost FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'movement_id',       v_mvt_id,
        'product_id',        p_product_id,
        'old_cost',          v_replay_old_cost,
        'new_cost',          v_old_cost,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT cost_price, unit INTO v_old_cost, v_unit
    FROM products
   WHERE id = p_product_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_unit := COALESCE(v_unit, 'pcs');

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    idempotency_key, reference_type, created_by, metadata
  ) VALUES (
    p_product_id,
    'cost_price_correction',
    0,
    v_unit,
    p_reason,
    p_new_cost,
    p_idempotency_key,
    'admin_action',
    v_profile,
    jsonb_build_object(
      'old_cost', v_old_cost,
      'new_cost', p_new_cost,
      'reason',   p_reason
    )
  )
  RETURNING id INTO v_mvt_id;

  UPDATE products
     SET cost_price = p_new_cost,
         updated_at = now()
   WHERE id = p_product_id
     AND cost_price IS DISTINCT FROM p_new_cost;

  RETURN jsonb_build_object(
    'movement_id',       v_mvt_id,
    'product_id',        p_product_id,
    'old_cost',          v_old_cost,
    'new_cost',          p_new_cost,
    'idempotent_replay', false
  );
END $func$;

REVOKE EXECUTE ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) IS
  'S22 / DEV-S17-1.B-01 — Manual cost_price correction with audit row. '
  'Auth + has_permission(inventory.cost_correction) gated. Emits stock_movements '
  'row movement_type=cost_price_correction (quantity=0, reference_type=admin_action). '
  'Idempotent via p_idempotency_key. Fires the existing tr_snapshot_on_product_cost_change '
  'trigger so ancestor recipes are re-snapshotted automatically. '
  'Replay envelope reconstructs old_cost from stored stock_movements.metadata '
  '(fix 20260526000014 for replay-shape parity with fresh path).';
