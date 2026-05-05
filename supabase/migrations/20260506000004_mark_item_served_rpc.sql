-- 20260506000004_mark_item_served_rpc.sql
-- Session 4 / migration 4 : RPC mark_item_served
-- K2: transition ready → served uniquement. P0011 si l'item n'est pas 'ready' ou inexistant.

CREATE OR REPLACE FUNCTION mark_item_served(p_item_id UUID)
RETURNS order_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row order_items;
BEGIN
  UPDATE order_items
    SET kitchen_status = 'served',
        served_at      = now(),
        served_by      = auth.uid()
    WHERE id = p_item_id
      AND kitchen_status = 'ready'
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Item must be ready before serving' USING ERRCODE = 'P0011';
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION mark_item_served(UUID) TO authenticated, anon;

COMMENT ON FUNCTION mark_item_served(UUID) IS
  'Transitions order_item kitchen_status from ready → served. Raises P0011 if item is not ready or does not exist.';
