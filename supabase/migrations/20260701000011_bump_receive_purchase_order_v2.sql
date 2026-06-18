-- 20260701000011_bump_receive_purchase_order_v2.sql
-- Session 46 / Wave A3 — Bump receive_purchase_order_v1 → v2.
--
-- Changes vs v1 (migration 20260517000112 + hotfix 20260517000115):
--   1. BASE-UNIT CONVERSION: received_qty × purchase_order_items.unit_factor_to_base
--      is computed before calling record_stock_movement_v1. The stock movement is
--      recorded in the product's base unit (products.unit), not the PO-line unit.
--      The lot quantity is also converted. received_quantity on the line item is
--      still tracked in the PO-line unit (to match what the supplier shipped).
--   2. Uses canonical audit_logs (plural) directly instead of the legacy
--      audit_log compatibility view.
--   3. SET search_path = public, pg_temp (hardened path).
--
-- D5 (spec §2): units valid per product = base unit ∪ product_unit_alternatives
--   ∪ product_unit_contexts. Validation of which unit was chosen is delegated to
--   the front-end picker (Wave B2). The RPC accepts whatever unit is on the line
--   item and relies on unit_factor_to_base for the conversion.
--
-- RPC versioning: DROP v1 in this same migration (monotone contract).

-- ─── v2 ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION receive_purchase_order_v2(
  p_po_id           UUID,
  p_section_id      UUID,
  p_received_items  JSONB,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
  v_base_qty        DECIMAL(14,3);   -- converted to base unit
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
  -- Auth first.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_section_id IS NULL THEN
    RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_received_items IS NULL
     OR jsonb_typeof(p_received_items) <> 'array'
     OR jsonb_array_length(p_received_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotency replay: if a GRN already exists with this key, return it.
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
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  -- Lock the PO row to prevent concurrent receive calls.
  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_po.status NOT IN ('pending','partial') THEN
    RAISE EXCEPTION 'po_invalid_status: %', v_po.status USING ERRCODE = 'P0002';
  END IF;

  -- Section must exist and not be soft-deleted.
  IF NOT EXISTS (
    SELECT 1 FROM sections WHERE id = p_section_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Pre-generate the GRN id so we can stamp it on stock_movement metadata.
  v_grn_id := gen_random_uuid();

  -- Process each received line.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_received_items) LOOP
    v_po_item_id   := (v_item->>'po_item_id')::uuid;
    v_received_qty := (v_item->>'received_quantity')::numeric;

    IF v_po_item_id IS NULL THEN
      RAISE EXCEPTION 'po_item_id_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_received_qty IS NULL OR v_received_qty <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
    END IF;

    -- Lock line, read remaining qty (in PO-line unit).
    SELECT * INTO v_po_item FROM purchase_order_items
      WHERE id = v_po_item_id AND po_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'po_item_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_received_qty > (v_po_item.quantity - v_po_item.received_quantity) THEN
      RAISE EXCEPTION 'received_exceeds_ordered: po_item=% remaining=% requested=%',
        v_po_item_id, (v_po_item.quantity - v_po_item.received_quantity), v_received_qty
        USING ERRCODE = 'P0001';
    END IF;

    -- Resolve product (need base unit + shelf-life).
    SELECT id, unit, default_shelf_life_hours
      INTO v_product
      FROM products
      WHERE id = v_po_item.product_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- ── A3 KEY CHANGE: convert to base units ──────────────────────────────────
    -- v_received_qty is in the PO-line unit (e.g., "box").
    -- v_base_qty is in the product's base unit (e.g., "pcs").
    -- unit_factor_to_base DEFAULT 1 keeps existing behaviour for lines where
    -- PO unit = base unit.
    v_base_qty := round(v_received_qty * v_po_item.unit_factor_to_base, 10);
    -- ──────────────────────────────────────────────────────────────────────────

    -- Create lot UPFRONT if shelf-life is configured (uses base qty + base unit).
    v_lot_id := NULL;
    IF v_product.default_shelf_life_hours IS NOT NULL THEN
      v_lot_idem_key := CASE
        WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
        ELSE md5(p_idempotency_key::text || ':lot:' || v_po_item_id::text)::uuid
      END;
      v_lot_metadata := jsonb_build_object(
        'po_id',       p_po_id,
        'po_number',   v_po.po_number,
        'po_item_id',  v_po_item_id,
        'grn_id',      v_grn_id,
        'section_id',  p_section_id,
        'supplier_id', v_po.supplier_id
      );
      -- Pass base quantity + base unit to the lot. p_location_id = NULL (section
      -- captured via stock_movement.to_section_id, per hotfix _115).
      v_lot_id := (create_stock_lot_v1(
        p_product_id      := v_product.id,
        p_quantity        := v_base_qty,
        p_unit            := v_product.unit,           -- BASE unit
        p_location_id     := NULL,
        p_expires_at      := NULL,
        p_batch_number    := v_po.po_number || '-' || v_po_item_id::text,
        p_idempotency_key := v_lot_idem_key,
        p_metadata        := v_lot_metadata
      )->>'lot_id')::uuid;
    END IF;

    -- Record the stock movement in BASE units.
    v_mv_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':mv:' || v_po_item_id::text)::uuid
    END;

    v_mv_result := record_stock_movement_v1(
      p_product_id      := v_product.id,
      p_movement_type   := 'purchase',
      p_quantity        := v_base_qty,                 -- BASE qty
      p_reason          := 'Receipt against PO ' || v_po.po_number,
      p_unit_cost       := v_po_item.unit_cost,
      p_supplier_id     := v_po.supplier_id,
      p_idempotency_key := v_mv_idem_key,
      p_unit            := v_product.unit,             -- BASE unit (NOT NULL contract)
      p_from_section_id := NULL,
      p_to_section_id   := p_section_id,
      p_metadata        := jsonb_build_object(
                            'po_id',              p_po_id,
                            'po_number',          v_po.po_number,
                            'po_item_id',         v_po_item_id,
                            'grn_id',             v_grn_id,
                            'lot_id',             v_lot_id,
                            'po_line_unit',       v_po_item.unit,
                            'po_line_qty',        v_received_qty,
                            'unit_factor_to_base', v_po_item.unit_factor_to_base
                           ),
      p_lot_id          := v_lot_id
    );
    v_movements_count := v_movements_count + 1;

    -- Update line received_quantity in PO-line unit (matches what supplier shipped).
    UPDATE purchase_order_items
      SET received_quantity = received_quantity + v_received_qty,
          updated_at        = now()
      WHERE id = v_po_item_id;

    -- Accumulate GRN subtotal using PO-line unit_cost × received qty (in PO-line unit).
    v_grn_subtotal := v_grn_subtotal + round(v_received_qty * v_po_item.unit_cost, 2);
  END LOOP;

  -- Pro-rata VAT: guard against subtotal_po=0 (free goods PO).
  IF v_po.subtotal > 0 THEN
    v_grn_vat := round(v_po.vat_amount * (v_grn_subtotal / v_po.subtotal), 2);
  ELSE
    v_grn_vat := 0;
  END IF;
  v_grn_total := v_grn_subtotal + v_grn_vat;

  -- Generate GRN number.
  v_grn_number := 'GRN-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('goods_receipt_notes_seq')::text, 4, '0');

  -- INSERT GRN — the trg_create_purchase_je trigger fires here.
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

  -- Update PO status & received metadata.
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

  -- Audit (canonical audit_logs, plural).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile,
    'purchase_order.received',
    'purchase_orders',
    p_po_id,
    jsonb_build_object(
      'po_number',       v_po.po_number,
      'grn_id',          v_grn_id,
      'grn_number',      v_grn_number,
      'movements_count', v_movements_count,
      'subtotal',        v_grn_subtotal,
      'vat_amount',      v_grn_vat,
      'total',           v_grn_total,
      'new_status',      v_new_status,
      'idempotency_key', p_idempotency_key,
      'rpc_version',     'v2'
    )
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

COMMENT ON FUNCTION receive_purchase_order_v2(UUID, UUID, JSONB, UUID) IS
  'Session 46 — S46-A3. Atomic GRN receive, base-unit aware. '
  'Converts received_qty × unit_factor_to_base into base units before '
  'record_stock_movement_v1 (stock ledger always in base unit). '
  'received_quantity on PO line tracked in PO-line unit. '
  'Idempotent via p_idempotency_key. Gated by purchasing.po.receive (MANAGER+). '
  'Bumps v1 (ADD base-unit conversion + canonical audit_logs + pg_temp path).';

-- ─── DROP v1 (same migration, monotone versioning contract) ──────────────────
DROP FUNCTION IF EXISTS receive_purchase_order_v1(UUID, UUID, JSONB, UUID);

-- ─── GRANT + canonical 3-line REVOKE pair ────────────────────────────────────
GRANT EXECUTE ON FUNCTION receive_purchase_order_v2(UUID, UUID, JSONB, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION receive_purchase_order_v2(UUID, UUID, JSONB, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION receive_purchase_order_v2(UUID, UUID, JSONB, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
