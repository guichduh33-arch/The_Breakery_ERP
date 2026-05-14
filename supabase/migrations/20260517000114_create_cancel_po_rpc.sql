-- 20260517000114_create_cancel_po_rpc.sql
-- Session 13 / Phase 3.A — cancel_purchase_order_v1.
--
-- Cancels a PO that hasn't been received yet. Manager+ (purchasing.po.cancel).
--
-- Refusal logic:
--   - status='received'    → 'PO_ALREADY_RECEIVED'
--   - status='cancelled'   → 'PO_ALREADY_CANCELLED'
--   - any GRN exists       → 'PO_PARTIALLY_RECEIVED' (forces purchase_return
--                            flow instead, which is a future phase)
--
-- Side-effects: status='cancelled', cancel_reason set, cancelled_by/at set.
-- Items are kept for audit. Stock movements are NOT generated.

CREATE OR REPLACE FUNCTION cancel_purchase_order_v1(
  p_po_id   UUID,
  p_reason  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_po        RECORD;
  v_grn_count INT;
BEGIN
  IF NOT has_permission(v_uid, 'purchasing.po.cancel') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE='P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_po.status = 'received' THEN
    RAISE EXCEPTION 'PO_ALREADY_RECEIVED' USING ERRCODE='P0002';
  END IF;
  IF v_po.status = 'cancelled' THEN
    RAISE EXCEPTION 'PO_ALREADY_CANCELLED' USING ERRCODE='P0002';
  END IF;

  SELECT COUNT(*) INTO v_grn_count FROM goods_receipt_notes WHERE po_id = p_po_id;
  IF v_grn_count > 0 THEN
    RAISE EXCEPTION 'PO_PARTIALLY_RECEIVED' USING ERRCODE='P0002',
      DETAIL = format('grn_count=%s', v_grn_count);
  END IF;

  UPDATE purchase_orders
    SET status        = 'cancelled',
        cancel_reason = p_reason,
        cancelled_by  = v_profile,
        cancelled_at  = now(),
        updated_at    = now()
    WHERE id = p_po_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'purchase_order.cancel', 'purchase_orders', p_po_id,
    jsonb_build_object(
      'po_number',      v_po.po_number,
      'previous_status', v_po.status,
      'reason',         p_reason
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'po_id',     p_po_id,
    'po_number', v_po.po_number,
    'status',    'cancelled',
    'reason',    p_reason
  );
END $$;

GRANT EXECUTE ON FUNCTION cancel_purchase_order_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION cancel_purchase_order_v1 FROM anon;

COMMENT ON FUNCTION cancel_purchase_order_v1 IS
  'Session 13 — Phase 3.A. Cancels a non-received PO. Refuses if any GRN '
  'exists (PO_PARTIALLY_RECEIVED) or status=received (PO_ALREADY_RECEIVED). '
  'Gated by purchasing.po.cancel (MANAGER+).';
