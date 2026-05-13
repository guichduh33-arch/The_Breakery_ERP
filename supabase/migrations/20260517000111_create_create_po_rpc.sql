-- 20260517000111_create_create_po_rpc.sql
-- Session 13 / Phase 3.A — create_purchase_order_v1 atomic RPC.
--
-- Manager+ (purchasing.po.create). Validates input, computes header totals,
-- inserts purchase_orders row + N purchase_order_items rows, returns
-- { po_id, po_number, total_amount, status: 'pending' }.
--
-- Items contract: array of { product_id (uuid), quantity (numeric),
-- unit (text, optional — falls back to products.unit), unit_cost (numeric) }.
--
-- VAT: caller passes `p_vat_rate` (default 0.11 — Indonesian PPN). The RPC
-- computes vat_amount = round(subtotal * vat_rate, 2). To override (e.g.,
-- supplier with reverse-charge exemption), caller passes p_vat_rate=0.
--
-- Idempotency: same p_idempotency_key returns the existing PO with
-- idempotent_replay=true.

CREATE OR REPLACE FUNCTION create_purchase_order_v1(
  p_supplier_id     UUID,
  p_items           JSONB,
  p_expected_date   DATE          DEFAULT NULL,
  p_order_date      DATE          DEFAULT NULL,
  p_payment_terms   TEXT          DEFAULT 'credit',
  p_vat_rate        DECIMAL(6,4)  DEFAULT 0.11,
  p_notes           TEXT          DEFAULT NULL,
  p_idempotency_key UUID          DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_po_id        UUID;
  v_po_number    TEXT;
  v_existing     UUID;
  v_existing_no  TEXT;
  v_subtotal     DECIMAL(14,2) := 0;
  v_vat_amount   DECIMAL(14,2);
  v_total        DECIMAL(14,2);
  v_item_count   INT := 0;
  v_item         JSONB;
  v_product_id   UUID;
  v_quantity     DECIMAL(14,3);
  v_unit         TEXT;
  v_unit_cost    DECIMAL(14,2);
  v_line_sub     DECIMAL(14,2);
  v_product_unit TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'purchasing.po.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required' USING ERRCODE='P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE='P0001';
  END IF;
  IF p_payment_terms NOT IN ('cash','credit') THEN
    RAISE EXCEPTION 'invalid_payment_terms' USING ERRCODE='P0001';
  END IF;
  IF p_vat_rate IS NULL OR p_vat_rate < 0 OR p_vat_rate > 1 THEN
    RAISE EXCEPTION 'invalid_vat_rate' USING ERRCODE='P0001';
  END IF;

  -- Idempotency replay.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, po_number INTO v_existing, v_existing_no
      FROM purchase_orders WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT total_amount INTO v_total FROM purchase_orders WHERE id = v_existing;
      RETURN jsonb_build_object(
        'po_id',             v_existing,
        'po_number',         v_existing_no,
        'total_amount',      v_total,
        'status',            (SELECT status FROM purchase_orders WHERE id = v_existing),
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

  -- Validate supplier exists and is active.
  IF NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE id = p_supplier_id AND is_active = TRUE AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'supplier_not_found' USING ERRCODE='P0002';
  END IF;

  -- Validate each item + accumulate subtotal.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::numeric;
    v_unit       := NULLIF(v_item->>'unit', '');
    v_unit_cost  := (v_item->>'unit_cost')::numeric;

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'product_id_required' USING ERRCODE='P0001';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE='P0001';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'unit_cost_must_be_non_negative' USING ERRCODE='P0001';
    END IF;

    SELECT unit INTO v_product_unit FROM products
      WHERE id = v_product_id AND is_active = TRUE AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
    END IF;

    v_unit := COALESCE(v_unit, v_product_unit, 'pcs');
    v_line_sub := round(v_quantity * v_unit_cost, 2);
    v_subtotal := v_subtotal + v_line_sub;
    v_item_count := v_item_count + 1;
  END LOOP;

  v_vat_amount := round(v_subtotal * p_vat_rate, 2);
  v_total      := v_subtotal + v_vat_amount;

  -- Generate po_number.
  v_po_number := 'PO-'
    || to_char(COALESCE(p_order_date, current_date), 'YYYYMMDD')
    || '-'
    || lpad(nextval('purchase_orders_seq')::text, 4, '0');

  -- Insert header.
  INSERT INTO purchase_orders (
    po_number, supplier_id, status, payment_terms,
    subtotal, vat_amount, total_amount,
    order_date, expected_date, notes,
    idempotency_key, created_by
  ) VALUES (
    v_po_number, p_supplier_id, 'pending', p_payment_terms,
    v_subtotal, v_vat_amount, v_total,
    COALESCE(p_order_date, current_date), p_expected_date, p_notes,
    p_idempotency_key, v_profile
  ) RETURNING id INTO v_po_id;

  -- Insert line items (replay items array — already validated).
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::numeric;
    v_unit       := NULLIF(v_item->>'unit', '');
    v_unit_cost  := (v_item->>'unit_cost')::numeric;

    SELECT unit INTO v_product_unit FROM products WHERE id = v_product_id;
    v_unit := COALESCE(v_unit, v_product_unit, 'pcs');

    INSERT INTO purchase_order_items (po_id, product_id, quantity, unit, unit_cost, notes)
      VALUES (v_po_id, v_product_id, v_quantity, v_unit, v_unit_cost, NULLIF(v_item->>'notes',''));
  END LOOP;

  -- Audit.
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'purchase_order.create', 'purchase_orders', v_po_id,
    jsonb_build_object(
      'po_number',     v_po_number,
      'supplier_id',   p_supplier_id,
      'item_count',    v_item_count,
      'subtotal',      v_subtotal,
      'vat_amount',    v_vat_amount,
      'total_amount',  v_total,
      'payment_terms', p_payment_terms,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'po_id',             v_po_id,
    'po_number',         v_po_number,
    'subtotal',          v_subtotal,
    'vat_amount',        v_vat_amount,
    'total_amount',      v_total,
    'status',            'pending',
    'item_count',        v_item_count,
    'idempotent_replay', false
  );
END $$;

GRANT EXECUTE ON FUNCTION create_purchase_order_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION create_purchase_order_v1 FROM anon;

COMMENT ON FUNCTION create_purchase_order_v1 IS
  'Session 13 — Phase 3.A. Atomic create-PO RPC. Validates items + supplier, '
  'computes subtotal/vat/total, inserts header + lines, status pending. '
  'Idempotent via p_idempotency_key. Gated by purchasing.po.create (MANAGER+).';
