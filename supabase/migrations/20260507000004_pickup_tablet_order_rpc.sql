-- 20260507000004_pickup_tablet_order_rpc.sql
-- Session 5 / migration 4 : pickup_tablet_order RPC
-- Cashier atomically claims a pending tablet order: status pending_payment → draft,
-- session_id bound to p_session_id.
-- Race condition: second caller gets 0 rows → P0012.

CREATE OR REPLACE FUNCTION pickup_tablet_order(
  p_order_id   UUID,
  p_session_id UUID
) RETURNS orders
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

  IF NOT has_permission(v_user_id, 'payments.process') THEN
    RAISE EXCEPTION 'Permission denied: payments.process' USING ERRCODE = 'P0003';
  END IF;

  UPDATE orders
    SET status         = 'draft',
        session_id     = p_session_id,
        updated_at     = now()
    WHERE id           = p_order_id
      AND status       = 'pending_payment'
      AND created_via  = 'tablet'
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Order already picked up or not pending_payment'
      USING ERRCODE = 'P0012';
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION pickup_tablet_order TO authenticated;

COMMENT ON FUNCTION pickup_tablet_order IS
  'Session 5: atomically transitions tablet order pending_payment → draft, binds pos_session_id. Race → P0012.';
