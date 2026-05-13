-- 20260516000021_create_record_incoming_stock_rpc.sql
-- Session 12 / Phase 2 — record_incoming_stock_v1 (MANAGER+).
-- Free-form stock receipt without a Purchase Order. Supplier is OPTIONAL
-- (NULL allowed) — distinguishes this RPC from receive_stock_v1 which
-- requires an active supplier. Inserts a movement of type 'incoming' via
-- record_stock_movement_v1.
--
-- Permission gate reuses 'inventory.receive' (granted to MANAGER+ since
-- migration 20260516000004; ADMIN/SUPER_ADMIN have unconditional true).
--
-- stock_movements section constraint exempts 'incoming' (migration
-- 20260516000020), so this RPC does NOT pass section ids. The 'unit' column
-- is auto-resolved by record_stock_movement_v1 v2 from products.unit
-- (migration 20260516000019), so no p_unit is forwarded.

CREATE OR REPLACE FUNCTION record_incoming_stock_v1(
  p_product_id      UUID,
  p_quantity        DECIMAL(10,3),
  p_supplier_id     UUID          DEFAULT NULL,
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

  -- Supplier is OPTIONAL on this RPC (free-form receipt). When provided it
  -- must point to an active, non-deleted supplier; otherwise we mirror the
  -- receive_stock_v1 contract and reject with supplier_not_found_or_inactive.
  IF p_supplier_id IS NOT NULL THEN
    SELECT code INTO v_supplier_code FROM suppliers
     WHERE id = p_supplier_id AND is_active = true AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'supplier_not_found_or_inactive' USING ERRCODE='P0002';
    END IF;
  END IF;

  IF v_reason IS NULL OR length(trim(v_reason)) < 3 THEN
    v_reason := CASE
      WHEN p_supplier_id IS NULL THEN 'Stock receipt'
      ELSE 'Receipt from ' || v_supplier_code
    END;
  END IF;

  RETURN record_stock_movement_v1(
    p_product_id      := p_product_id,
    p_movement_type   := 'incoming',
    p_quantity        := p_quantity,
    p_reason          := v_reason,
    p_unit_cost       := p_unit_cost,
    p_supplier_id     := p_supplier_id,
    p_idempotency_key := p_idempotency_key
  );
END $$;

REVOKE EXECUTE ON FUNCTION record_incoming_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION record_incoming_stock_v1 TO authenticated;

COMMENT ON FUNCTION record_incoming_stock_v1 IS
  'MANAGER+. Free-form stock receipt without PO. Supplier optional. '
  'Inserts movement_type=''incoming''. p_reason defaults to "Stock receipt" '
  'when no supplier, or "Receipt from <supplier code>" when supplier provided.';
