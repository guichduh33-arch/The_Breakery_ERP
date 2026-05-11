-- 20260516000008_create_receive_stock_rpc.sql
-- Session 12 / migration 8 : receive_stock_v1 (MANAGER+).
-- Record a stock receipt from an active supplier. Inserts a movement of
-- type 'purchase' via record_stock_movement_v1.

CREATE OR REPLACE FUNCTION receive_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_supplier_id     UUID,
  p_unit_cost       DECIMAL(14,2) DEFAULT NULL,
  p_reason          TEXT          DEFAULT NULL,
  p_idempotency_key UUID          DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_supplier_code TEXT;
  v_reason TEXT := p_reason;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  SELECT code INTO v_supplier_code FROM suppliers
   WHERE id = p_supplier_id AND is_active = true AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found_or_inactive' USING ERRCODE='P0002';
  END IF;

  IF v_reason IS NULL OR length(trim(v_reason)) < 3 THEN
    v_reason := 'Receipt from ' || v_supplier_code;
  END IF;

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'purchase',
    p_quantity        := p_quantity,
    p_reason          := v_reason,
    p_unit_cost       := p_unit_cost,
    p_supplier_id     := p_supplier_id,
    p_idempotency_key := p_idempotency_key
  );
END $$;

REVOKE EXECUTE ON FUNCTION receive_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION receive_stock_v1 TO authenticated;

COMMENT ON FUNCTION receive_stock_v1 IS
  'MANAGER+. Record a stock receipt from an active supplier. Inserts a movement of type "purchase". '
  'p_reason defaults to "Receipt from <supplier code>" when NULL.';
