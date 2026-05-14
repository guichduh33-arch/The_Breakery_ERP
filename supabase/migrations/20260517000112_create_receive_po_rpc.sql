-- 20260517000112_create_receive_po_rpc.sql
-- Session 13 / Phase 3.A — receive_purchase_order_v1 atomic RPC.
--
-- Atomic goods receipt:
--   1. Validate PO status ∈ ('pending','partial').
--   2. For each received line:
--      a. Validate received_quantity > 0 and ≤ remaining ordered quantity.
--      b. If product has default_shelf_life_hours SET → call
--         create_stock_lot_v1 UPFRONT and capture lot_id.
--      c. Call record_stock_movement_v1(movement_type='purchase',
--         reference_type='purchase_order', reference_id=p_po_id,
--         lot_id=v_lot_id).
--      d. Update purchase_order_items.received_quantity += received_qty.
--   3. Compute GRN totals: subtotal_grn = SUM(received_qty * line.unit_cost),
--      vat_grn = pro-rata of PO vat_amount × (subtotal_grn / PO.subtotal),
--      total_grn = subtotal_grn + vat_grn.
--   4. INSERT goods_receipt_notes — the trg_create_purchase_je trigger
--      (attached in 000113) fires and posts the JE.
--   5. Update PO status: 'received' if every line fully received, else 'partial'.
--   6. Return { grn_id, grn_number, je_id, movements_count, status }.
--
-- Permission: purchasing.po.receive (MANAGER+). Also requires
-- inventory.receive (the create_stock_lot_v1 primitive gates on this).
-- The seeded roles (SUPER_ADMIN/ADMIN/MANAGER) already hold both.
--
-- Idempotency: same p_idempotency_key returns the existing GRN row.

CREATE OR REPLACE FUNCTION receive_purchase_order_v1(
  p_po_id           UUID,
  p_section_id      UUID,
  p_received_items  JSONB,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid             UUID := auth.uid();
  v_profile         UUID;
  v_po              RECORD;
  v_existing_grn    UUID;
  v_existing_no     TEXT;
  v_grn_id          UUID;
  v_grn_number      TEXT;
  v_grn_subtotal    DECIMAL(14,2) := 0;
  v_grn_vat         DECIMAL(14,2);
  v_grn_total       DECIMAL(14,2);
  v_movements_count INT := 0;
  v_je_id           UUID;
  v_item            JSONB;
  v_po_item_id      UUID;
  v_received_qty    DECIMAL(14,3);
  v_po_item         RECORD;
  v_product         RECORD;
  v_lot_id          UUID;
  v_lot_idem_key    UUID;
  v_lot_metadata    JSONB;
  v_mv_idem_key     UUID;
  v_mv_result       JSONB;
  v_total_ordered   DECIMAL(14,3);
  v_total_received  DECIMAL(14,3);
  v_new_status      TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'purchasing.po.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE='P0001';
  END IF;
  IF p_section_id IS NULL THEN
    RAISE EXCEPTION 'section_required' USING ERRCODE='P0001';
  END IF;
  IF p_received_items IS NULL
     OR jsonb_typeof(p_received_items) <> 'array'
     OR jsonb_array_length(p_received_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE='P0001';
  END IF;

  -- Idempotency replay : if a GRN already exists with this key, return it.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, grn_number INTO v_existing_grn, v_existing_no
      FROM goods_receipt_notes WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_grn IS NOT NULL THEN
      SELECT COUNT(*) INTO v_movements_count
        FROM stock_movements
        WHERE reference_type = 'purchase_order'
          AND metadata->>'grn_id' = v_existing_grn::text;
      SELECT id INTO v_je_id FROM journal_entries
        WHERE reference_type = 'purchase' AND reference_id = v_existing_grn LIMIT 1;
      RETURN jsonb_build_object(
        'grn_id',            v_existing_grn,
        'grn_number',        v_existing_no,
        'je_id',             v_je_id,
        'movements_count',   v_movements_count,
        'status',            (SELECT status FROM purchase_orders WHERE id = p_po_id),
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- Resolve actor profile.
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Lock the PO row to prevent concurrent receive_purchase_order_v1 calls.
  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE='P0002';
  END IF;
  IF v_po.status NOT IN ('pending','partial') THEN
    RAISE EXCEPTION 'po_invalid_status: %', v_po.status USING ERRCODE='P0002';
  END IF;

  -- Section must exist and not be soft-deleted.
  IF NOT EXISTS (
    SELECT 1 FROM sections WHERE id = p_section_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE='P0002';
  END IF;

  -- We need a placeholder GRN id NOW so we can stamp it on stock_movements
  -- metadata (so idempotent replay can count movements). Generate UUID.
  v_grn_id := gen_random_uuid();

  -- Process each received line.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_received_items) LOOP
    v_po_item_id   := (v_item->>'po_item_id')::uuid;
    v_received_qty := (v_item->>'received_quantity')::numeric;

    IF v_po_item_id IS NULL THEN
      RAISE EXCEPTION 'po_item_id_required' USING ERRCODE='P0001';
    END IF;
    IF v_received_qty IS NULL OR v_received_qty <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
    END IF;

    -- Lock the line, read remaining qty.
    SELECT * INTO v_po_item FROM purchase_order_items
      WHERE id = v_po_item_id AND po_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'po_item_not_found' USING ERRCODE='P0002';
    END IF;
    IF v_received_qty > (v_po_item.quantity - v_po_item.received_quantity) THEN
      RAISE EXCEPTION 'received_exceeds_ordered: po_item=% remaining=% requested=%',
        v_po_item_id, (v_po_item.quantity - v_po_item.received_quantity), v_received_qty
        USING ERRCODE='P0001';
    END IF;

    -- Resolve product (need unit + shelf-life).
    SELECT id, unit, default_shelf_life_hours
      INTO v_product
      FROM products
      WHERE id = v_po_item.product_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
    END IF;

    -- Create lot UPFRONT if shelf-life is configured. Use a deterministic
    -- idempotency key derived from the GRN id + line so a retry replays.
    v_lot_id := NULL;
    IF v_product.default_shelf_life_hours IS NOT NULL THEN
      v_lot_idem_key := CASE
        WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
        ELSE md5(p_idempotency_key::text || ':lot:' || v_po_item_id::text)::uuid
      END;
      v_lot_metadata := jsonb_build_object(
        'po_id',     p_po_id,
        'po_number', v_po.po_number,
        'po_item_id', v_po_item_id,
        'grn_id',    v_grn_id,
        'supplier_id', v_po.supplier_id
      );
      -- p_location_id refers to stock_locations (a child of sections),
      -- not sections directly. We leave it NULL — the section is captured
      -- via stock_movement.to_section_id below. If granular bin-level
      -- tracking is needed later, resolve a stock_locations row first.
      v_lot_id := (create_stock_lot_v1(
        p_product_id      := v_product.id,
        p_quantity        := v_received_qty,
        p_unit            := v_po_item.unit,
        p_location_id     := NULL,
        p_expires_at      := NULL,
        p_batch_number    := v_po.po_number || '-' || v_po_item_id::text,
        p_idempotency_key := v_lot_idem_key,
        p_metadata        := v_lot_metadata
      )->>'lot_id')::uuid;
    END IF;

    -- Record the stock movement. movement_type='purchase'.
    v_mv_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':mv:' || v_po_item_id::text)::uuid
    END;

    v_mv_result := record_stock_movement_v1(
      p_product_id      := v_product.id,
      p_movement_type   := 'purchase',
      p_quantity        := v_received_qty,
      p_reason          := 'Receipt against PO ' || v_po.po_number,
      p_unit_cost       := v_po_item.unit_cost,
      p_supplier_id     := v_po.supplier_id,
      p_idempotency_key := v_mv_idem_key,
      p_unit            := v_po_item.unit,
      p_from_section_id := NULL,
      p_to_section_id   := p_section_id,
      p_metadata        := jsonb_build_object(
                            'po_id',       p_po_id,
                            'po_number',   v_po.po_number,
                            'po_item_id',  v_po_item_id,
                            'grn_id',      v_grn_id,
                            'lot_id',      v_lot_id
                           ),
      p_lot_id          := v_lot_id
    );
    v_movements_count := v_movements_count + 1;

    -- Update line received_quantity.
    UPDATE purchase_order_items
      SET received_quantity = received_quantity + v_received_qty,
          updated_at        = now()
      WHERE id = v_po_item_id;

    -- Accumulate GRN subtotal (received-line value).
    v_grn_subtotal := v_grn_subtotal + round(v_received_qty * v_po_item.unit_cost, 2);
  END LOOP;

  -- Pro-rata VAT: vat_grn = round(vat_po * subtotal_grn / subtotal_po, 2).
  -- Guard against subtotal_po=0 (free goods PO — vat_po should be 0 too).
  IF v_po.subtotal > 0 THEN
    v_grn_vat := round(v_po.vat_amount * (v_grn_subtotal / v_po.subtotal), 2);
  ELSE
    v_grn_vat := 0;
  END IF;
  v_grn_total := v_grn_subtotal + v_grn_vat;

  -- Generate grn_number.
  v_grn_number := 'GRN-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('goods_receipt_notes_seq')::text, 4, '0');

  -- INSERT GRN — the trg_create_purchase_je trigger (000113) will fire and
  -- post the JE atomically here.
  INSERT INTO goods_receipt_notes (
    id, grn_number, po_id, received_by, received_date, payment_terms,
    subtotal, vat_amount, total, notes, idempotency_key,
    metadata
  ) VALUES (
    v_grn_id, v_grn_number, p_po_id, v_profile, current_date, v_po.payment_terms,
    v_grn_subtotal, v_grn_vat, v_grn_total, NULL, p_idempotency_key,
    jsonb_build_object(
      'po_number',   v_po.po_number,
      'supplier_id', v_po.supplier_id,
      'section_id',  p_section_id,
      'lines',       jsonb_array_length(p_received_items)
    )
  );

  -- Resolve JE that the trigger just posted.
  SELECT id INTO v_je_id FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = v_grn_id LIMIT 1;

  -- Update PO status & received_by/received_date.
  SELECT SUM(quantity), SUM(received_quantity)
    INTO v_total_ordered, v_total_received
    FROM purchase_order_items WHERE po_id = p_po_id;

  IF v_total_received >= v_total_ordered THEN
    v_new_status := 'received';
  ELSE
    v_new_status := 'partial';
  END IF;

  UPDATE purchase_orders
    SET status        = v_new_status,
        received_by   = COALESCE(received_by, v_profile),
        received_date = CASE WHEN v_new_status = 'received' THEN current_date
                             ELSE received_date END,
        updated_at    = now()
    WHERE id = p_po_id;

  -- Audit.
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'purchase_order.receive', 'purchase_orders', p_po_id,
    jsonb_build_object(
      'po_number',       v_po.po_number,
      'grn_id',          v_grn_id,
      'grn_number',      v_grn_number,
      'movements_count', v_movements_count,
      'subtotal',        v_grn_subtotal,
      'vat_amount',      v_grn_vat,
      'total',           v_grn_total,
      'new_status',      v_new_status,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'grn_id',            v_grn_id,
    'grn_number',        v_grn_number,
    'je_id',             v_je_id,
    'movements_count',   v_movements_count,
    'subtotal',          v_grn_subtotal,
    'vat_amount',        v_grn_vat,
    'total',             v_grn_total,
    'status',            v_new_status,
    'idempotent_replay', false
  );
END $$;

GRANT EXECUTE ON FUNCTION receive_purchase_order_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION receive_purchase_order_v1 FROM anon;

COMMENT ON FUNCTION receive_purchase_order_v1 IS
  'Session 13 — Phase 3.A. Atomic GRN RPC. Validates PO + lines, mints lots '
  'UPFRONT (if shelf-life set), records purchase stock_movements, INSERTs GRN '
  '(trg_create_purchase_je posts JE), updates PO status. Idempotent via '
  'p_idempotency_key. Gated by purchasing.po.receive (MANAGER+).';
