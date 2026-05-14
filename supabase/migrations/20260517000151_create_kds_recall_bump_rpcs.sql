-- 20260517000151_create_kds_recall_bump_rpcs.sql
-- Session 13 / Phase 4.B — KDS operate RPCs.
--
-- Four SECURITY DEFINER RPCs, gated on has_permission(auth.uid(), 'kds.operate').
--
--  * kds_start_prep_timer_v1(p_order_item_id UUID)
--    Sets prep_started_at = now(). Also transitions pending → preparing
--    (or noop if already in preparing/ready/served).
--
--  * kds_bump_item_v1(p_order_item_id UUID, p_idempotency_key UUID DEFAULT NULL)
--    Transitions preparing → ready. Sets ready_at = now() AND bumped_at = now().
--    Raises P0011 (existing convention) if not currently 'preparing'.
--    Idempotent : if the item was already bumped within the last 5 minutes
--    AND the idempotency key was previously recorded, returns silently.
--
--  * kds_undo_bump_v1(p_order_item_id UUID)
--    Within 60s of bumped_at : ready → preparing. Clears ready_at + bumped_at.
--    Raises P0012 (kds_undo_window_expired) if bumped_at IS NULL or
--    NOW() - bumped_at > INTERVAL '60 seconds'.
--    Logs to audit_logs (action='kds.undo_bump').
--
--  * kds_recall_order_v1(p_order_id UUID, p_reason TEXT DEFAULT NULL)
--    For every order_item where served_at IS NOT NULL : served → preparing.
--    Clears served_at/served_by/ready_at/bumped_at.
--    Logs to audit_logs (action='kds.recall', entity_type='order',
--    entity_id=p_order_id, metadata={reason, items_recalled}).
--
-- Spec ref : docs/workplan/plans/2026-05-13-session-13-phase-4.B-kds-ext.md
-- has_permission() is LOCKED — we ONLY call it, never CREATE OR REPLACE it.

-- ===========================================================================
-- kds_start_prep_timer_v1
-- ===========================================================================
CREATE OR REPLACE FUNCTION kds_start_prep_timer_v1(p_order_item_id UUID)
RETURNS order_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row order_items;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  -- Read current state for guard
  SELECT * INTO v_row FROM order_items WHERE id = p_order_item_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'order_item not found: %', p_order_item_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Already ready/served : noop (return row as-is).
  IF v_row.kitchen_status IN ('ready', 'served') THEN
    RETURN v_row;
  END IF;

  -- pending → preparing AND/OR (already preparing) → set prep_started_at if NULL
  UPDATE order_items
     SET kitchen_status   = CASE WHEN kitchen_status = 'pending' THEN 'preparing' ELSE kitchen_status END,
         prep_started_at  = COALESCE(prep_started_at, NOW())
   WHERE id = p_order_item_id
     AND kitchen_status IN ('pending', 'preparing')
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION kds_start_prep_timer_v1(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kds_start_prep_timer_v1(UUID) TO authenticated;

COMMENT ON FUNCTION kds_start_prep_timer_v1(UUID) IS
  'Phase 4.B : starts (or carries through) the prep timer on an order_item. '
  'Transitions pending→preparing (idempotent). Sets prep_started_at if NULL. '
  'Gated on has_permission(auth.uid(), ''kds.operate'').';

-- ===========================================================================
-- kds_bump_item_v1
-- ===========================================================================
CREATE OR REPLACE FUNCTION kds_bump_item_v1(
  p_order_item_id   UUID,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS order_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     order_items;
  v_now     TIMESTAMPTZ := NOW();
  v_replay  BOOLEAN := FALSE;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotency check (replay) : if a recent audit_log row carries this
  -- idempotency key for THIS item, return the current row unchanged.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT TRUE INTO v_replay
      FROM audit_logs
     WHERE action = 'kds.bump_item'
       AND entity_type = 'order_item'
       AND entity_id = p_order_item_id
       AND metadata ? 'idempotency_key'
       AND metadata->>'idempotency_key' = p_idempotency_key::TEXT
     LIMIT 1;
    IF v_replay THEN
      SELECT * INTO v_row FROM order_items WHERE id = p_order_item_id;
      RETURN v_row;
    END IF;
  END IF;

  UPDATE order_items
     SET kitchen_status = 'ready',
         ready_at       = v_now,
         bumped_at      = v_now
   WHERE id = p_order_item_id
     AND kitchen_status = 'preparing'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Item must be preparing before bumping to ready'
      USING ERRCODE = 'P0011';
  END IF;

  -- Record audit row when idempotency key supplied (used for replay).
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (
      auth.uid(),
      'kds.bump_item',
      'order_item',
      p_order_item_id,
      jsonb_build_object(
        'idempotency_key', p_idempotency_key::TEXT,
        'bumped_at',       v_now
      )
    );
  END IF;

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION kds_bump_item_v1(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kds_bump_item_v1(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION kds_bump_item_v1(UUID, UUID) IS
  'Phase 4.B : bumps an order_item from preparing→ready. Sets ready_at + bumped_at = NOW(). '
  'Raises P0011 if not currently preparing. Idempotency via p_idempotency_key (replay returns current row).';

-- ===========================================================================
-- kds_undo_bump_v1 — within 60s of bumped_at
-- ===========================================================================
CREATE OR REPLACE FUNCTION kds_undo_bump_v1(p_order_item_id UUID)
RETURNS order_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row order_items;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM order_items WHERE id = p_order_item_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'order_item not found: %', p_order_item_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_row.kitchen_status <> 'ready' THEN
    RAISE EXCEPTION 'Item must be ready to undo bump'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_row.bumped_at IS NULL
     OR NOW() - v_row.bumped_at > INTERVAL '60 seconds' THEN
    RAISE EXCEPTION 'kds_undo_window_expired'
      USING ERRCODE = 'P0012',
            DETAIL  = format('bumped_at=%s, now=%s', v_row.bumped_at, NOW());
  END IF;

  UPDATE order_items
     SET kitchen_status = 'preparing',
         ready_at       = NULL,
         bumped_at      = NULL
   WHERE id = p_order_item_id
  RETURNING * INTO v_row;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'kds.undo_bump',
    'order_item',
    p_order_item_id,
    jsonb_build_object('undone_at', NOW())
  );

  RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION kds_undo_bump_v1(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kds_undo_bump_v1(UUID) TO authenticated;

COMMENT ON FUNCTION kds_undo_bump_v1(UUID) IS
  'Phase 4.B : within 60s of bumped_at, transitions ready→preparing. '
  'Raises P0012 (kds_undo_window_expired) if window passed or bumped_at is NULL.';

-- ===========================================================================
-- kds_recall_order_v1 — recall the served items of an order
-- ===========================================================================
CREATE OR REPLACE FUNCTION kds_recall_order_v1(
  p_order_id UUID,
  p_reason   TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT has_permission(auth.uid(), 'kds.operate') THEN
    RAISE EXCEPTION 'permission_denied: kds.operate required'
      USING ERRCODE = '42501';
  END IF;

  -- Validate order exists.
  IF NOT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'order not found: %', p_order_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE order_items
     SET kitchen_status = 'preparing',
         served_at      = NULL,
         served_by      = NULL,
         ready_at       = NULL,
         bumped_at      = NULL
   WHERE order_id = p_order_id
     AND kitchen_status = 'served';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    -- Nothing to recall — return 0 (caller may decide to show toast).
    RETURN 0;
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'kds.recall',
    'order',
    p_order_id,
    jsonb_build_object(
      'reason',          COALESCE(p_reason, ''),
      'items_recalled',  v_count,
      'recalled_at',     NOW()
    )
  );

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION kds_recall_order_v1(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kds_recall_order_v1(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION kds_recall_order_v1(UUID, TEXT) IS
  'Phase 4.B : recalls served items of an order back to preparing. Returns count of items recalled. '
  'Logs to audit_logs (action=''kds.recall''). Gated on has_permission(auth.uid(), ''kds.operate'').';
