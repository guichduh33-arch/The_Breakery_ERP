-- 20260507000006_cancel_tablet_order_rpc.sql
-- Session 5 / migration 6 : cancel_tablet_order RPC
-- Waiter cancels their own pending tablet order (pre-pickup only).
-- After pickup (status=draft), cancellation goes through POS void flow (session 7).

CREATE OR REPLACE FUNCTION cancel_tablet_order(p_order_id UUID)
RETURNS orders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_row     orders;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_user_id, 'sales.create') THEN
    RAISE EXCEPTION 'Permission denied: sales.create' USING ERRCODE = 'P0003';
  END IF;

  UPDATE orders
    SET status     = 'voided',
        updated_at = now()
    WHERE id          = p_order_id
      AND status      = 'pending_payment'
      AND created_via = 'tablet'
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Cannot cancel — order not pending_payment'
      USING ERRCODE = 'P0013';
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION cancel_tablet_order TO authenticated;

COMMENT ON FUNCTION cancel_tablet_order IS
  'Session 5: voids a tablet order while still pending_payment (pre-pickup). After pickup → P0013.';
