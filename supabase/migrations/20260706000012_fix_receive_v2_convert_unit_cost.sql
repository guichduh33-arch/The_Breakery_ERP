-- 20260706000012_fix_receive_v2_convert_unit_cost.sql
-- Corrective — receive_purchase_order_v2 converted the received QUANTITY to base
-- units but passed unit_cost UNCONVERTED (per PO-line unit) to
-- record_stock_movement_v1. The WAC trigger (tr_update_product_cost_on_purchase)
-- then stored the per-PO-unit price as products.cost_price (per base unit), and
-- get_product_analytics_v1.movement_breakdown.value_total (Σ qty_base × unit_cost)
-- was overstated by the unit factor.
--
-- Reproduction (real data, Almond Ground SEE-012): base unit kg, Doz = 11.3 kg,
-- bought 1 Doz @ Rp 2,000,000 → stock +11.3 kg (correct) but cost_price = Rp
-- 2,000,000/kg instead of 2,000,000 / 11.3 ≈ Rp 176,991.15/kg.
--
-- Fix: pass the unit cost PER BASE UNIT = unit_cost / unit_factor_to_base, so it
-- is dimensionally consistent with the base-unit quantity already passed. Then
-- qty_base × unit_cost_base = received_qty × unit_cost (PO-line) = the invoice
-- total — every downstream reader (WAC, JE value, analytics value_total) becomes
-- correct. The GRN subtotal / accounting JE keep using the PO-line unit_cost
-- (line 237 below, unchanged) so the supplier invoice total is preserved.
--
-- Signature UNCHANGED → CREATE OR REPLACE (no v3 bump, no types regen).
-- purchase_order_items.unit_cost stays per-PO-line unit (supplier price trend).

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
  v_base_unit_cost  DECIMAL(14,2);   -- unit_cost converted to per-base-unit
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

    -- ── KEY CHANGE: convert BOTH quantity AND unit cost to the base unit ───────
    -- v_received_qty is in the PO-line unit (e.g., "Doz"); v_base_qty in the
    -- product base unit (e.g., "kg"). unit_factor_to_base DEFAULT 1 keeps the
    -- identity behaviour when PO unit = base unit.
    --   qty_base       = received_qty × factor
    --   unit_cost_base = unit_cost     ÷ factor   (price per base unit)
    -- so qty_base × unit_cost_base = received_qty × unit_cost = the invoice total.
    v_base_qty := round(v_received_qty * v_po_item.unit_factor_to_base, 10);
    v_base_unit_cost := CASE
      WHEN v_po_item.unit_cost IS NULL THEN NULL
      ELSE round(v_po_item.unit_cost / NULLIF(v_po_item.unit_factor_to_base, 0), 2)
    END;
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

    -- Record the stock movement in BASE units, with BASE-unit cost.
    v_mv_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':mv:' || v_po_item_id::text)::uuid
    END;

    v_mv_result := record_stock_movement_v1(
      p_product_id      := v_product.id,
      p_movement_type   := 'purchase',
      p_quantity        := v_base_qty,                 -- BASE qty
      p_reason          := 'Receipt against PO ' || v_po.po_number,
      p_unit_cost       := v_base_unit_cost,           -- BASE-unit cost (÷ factor)
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
                            'po_line_unit_cost',  v_po_item.unit_cost,
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
    -- Unchanged: this preserves the supplier invoice total for the JE.
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
  'Session 46 — S46-A3 (+ 2026-07-06 unit-cost conversion fix). Atomic GRN '
  'receive, base-unit aware. Converts received_qty × unit_factor_to_base into '
  'base units AND unit_cost ÷ unit_factor_to_base into per-base-unit cost before '
  'record_stock_movement_v1 (stock ledger + WAC always in base unit). GRN '
  'subtotal/JE keep the PO-line unit_cost (supplier invoice total). '
  'received_quantity on PO line tracked in PO-line unit. Idempotent via '
  'p_idempotency_key. Gated by purchasing.po.receive (MANAGER+).';

-- ─── GRANT + canonical 3-line REVOKE pair ────────────────────────────────────
GRANT EXECUTE ON FUNCTION receive_purchase_order_v2(UUID, UUID, JSONB, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION receive_purchase_order_v2(UUID, UUID, JSONB, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION receive_purchase_order_v2(UUID, UUID, JSONB, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
