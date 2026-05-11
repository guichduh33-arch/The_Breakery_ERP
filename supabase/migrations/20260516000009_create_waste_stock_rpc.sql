-- 20260516000009_create_waste_stock_rpc.sql
-- Session 12 / migration 9 : waste_stock_v1 (MANAGER+).
-- Record stock waste/spoilage. Caller passes p_quantity > 0; the RPC negates
-- it internally before delegating to record_stock_movement_v1.

CREATE OR REPLACE FUNCTION waste_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current DECIMAL(10,3);
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.waste') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'quantity_must_be_positive';
  END IF;

  SELECT current_stock INTO v_current FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_current < p_quantity THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'waste',
    p_quantity        := -p_quantity,  -- negate (caller supplies positive qty)
    p_reason          := p_reason,
    p_idempotency_key := p_idempotency_key
  );
END $$;

REVOKE EXECUTE ON FUNCTION waste_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION waste_stock_v1 TO authenticated;

COMMENT ON FUNCTION waste_stock_v1 IS
  'MANAGER+. Record stock waste/spoilage. p_quantity MUST be positive (the RPC negates internally). '
  'Refuses if p_quantity > current_stock (insufficient_stock P0002).';
