-- 20260516000007_create_adjust_stock_rpc.sql
-- Session 12 / migration 7 : adjust_stock_v1 (ADMIN+).
-- Set product stock to p_new_qty by computing signed delta and recording
-- a movement of type 'adjustment' via record_stock_movement_v1.

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
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.adjust') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_new_qty < 0 THEN
    RAISE EXCEPTION 'negative_qty_not_allowed';
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_delta := p_new_qty - v_current;
  IF v_delta = 0 THEN
    -- No-op but still informative; idempotency_key is NOT persisted in that case.
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

REVOKE EXECUTE ON FUNCTION adjust_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION adjust_stock_v1 TO authenticated;

COMMENT ON FUNCTION adjust_stock_v1 IS
  'ADMIN+. Set product stock to p_new_qty. Computes signed delta and records an "adjustment" movement. '
  'No-op (returns noop=true) if delta=0; idempotency_key is NOT persisted in that case.';
