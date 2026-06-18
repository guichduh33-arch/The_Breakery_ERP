-- 20260701000018_bump_create_purchase_order_v2.sql
-- Session 46 / Wave B0 — create_purchase_order_v2.
--
-- Closes the create-path half of R1 + R2 (DEV-S46-B2-01):
--   * R2 — persist per-item `unit_factor_to_base` so receive_purchase_order_v2
--     converts to base units correctly. v1 dropped the factor → every freshly
--     created line defaulted to factor 1 (silent wrong-stock at receipt for any
--     non-base unit).
--   * R1 — reject non raw_material products server-side (category_type =
--     'raw_material', D1), mirroring update_purchase_order_v1. The picker filters
--     client-side; this is the defense-in-depth twin on the write path.
--
-- RPC versioning monotone: identical typed signature, but the behaviour change
-- (raw_material rejection) is breaking, so we follow the receive_v1→v2 precedent:
-- CREATE v2 + DROP v1 in the same migration. Items contract gains an optional
-- `unit_factor_to_base` (numeric, default 1).

CREATE OR REPLACE FUNCTION create_purchase_order_v2(
  p_supplier_id     UUID,
  p_items           JSONB,
  p_expected_date   DATE          DEFAULT NULL,
  p_order_date      DATE          DEFAULT NULL,
  p_payment_terms   TEXT          DEFAULT 'credit',
  p_vat_rate        DECIMAL(6,4)  DEFAULT 0.11,
  p_notes           TEXT          DEFAULT NULL,
  p_idempotency_key UUID          DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_po_id        UUID;
  v_po_number    TEXT;
  v_existing     UUID;
  v_existing_no  TEXT;
  v_total_exist  DECIMAL(14,2);
  v_subtotal     DECIMAL(14,2) := 0;
  v_vat_amount   DECIMAL(14,2);
  v_total        DECIMAL(14,2);
  v_item_count   INT := 0;
  v_item         JSONB;
  v_product_id   UUID;
  v_quantity     DECIMAL(14,3);
  v_unit         TEXT;
  v_unit_cost    DECIMAL(14,2);
  v_factor       NUMERIC(20,10);
  v_line_sub     DECIMAL(14,2);
  v_product_unit TEXT;
  v_cat_type     TEXT;
BEGIN
  -- ── 1. Auth-first ─────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'purchasing.po.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_payment_terms NOT IN ('cash','credit') THEN
    RAISE EXCEPTION 'invalid_payment_terms' USING ERRCODE = 'P0001';
  END IF;
  IF p_vat_rate IS NULL OR p_vat_rate < 0 OR p_vat_rate > 1 THEN
    RAISE EXCEPTION 'invalid_vat_rate' USING ERRCODE = 'P0001';
  END IF;

  -- ── 2. Idempotency replay ─────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, po_number INTO v_existing, v_existing_no
      FROM purchase_orders WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT total_amount INTO v_total_exist FROM purchase_orders WHERE id = v_existing;
      RETURN jsonb_build_object(
        'po_id',             v_existing,
        'po_number',         v_existing_no,
        'total_amount',      v_total_exist,
        'status',            (SELECT status FROM purchase_orders WHERE id = v_existing),
        'idempotent_replay', true
      );
    END IF;
  END IF;

  -- ── 3. Resolve actor profile ──────────────────────────────────────────────
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  -- ── 4. Validate supplier ──────────────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE id = p_supplier_id AND is_active = TRUE AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- ── 5. Validate items + accumulate subtotal (R1 raw_material + factor) ─────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::numeric;
    v_unit       := NULLIF(v_item->>'unit', '');
    v_unit_cost  := (v_item->>'unit_cost')::numeric;
    v_factor     := COALESCE((v_item->>'unit_factor_to_base')::numeric, 1);

    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
    END IF;
    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'unit_cost_must_be_non_negative' USING ERRCODE = 'P0001';
    END IF;
    IF v_factor <= 0 THEN
      RAISE EXCEPTION 'unit_factor_must_be_positive' USING ERRCODE = 'P0001';
    END IF;

    -- D1: only raw_material products allowed on a PO.
    SELECT p.unit, c.category_type
      INTO v_product_unit, v_cat_type
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id AND p.is_active = TRUE AND p.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found: %', v_product_id USING ERRCODE = 'P0002';
    END IF;
    IF v_cat_type <> 'raw_material' THEN
      RAISE EXCEPTION 'product_not_raw_material: % (category_type=%)',
        v_product_id, v_cat_type USING ERRCODE = 'P0001';
    END IF;

    v_line_sub   := round(v_quantity * v_unit_cost, 2);
    v_subtotal   := v_subtotal + v_line_sub;
    v_item_count := v_item_count + 1;
  END LOOP;

  v_vat_amount := round(v_subtotal * p_vat_rate, 2);
  v_total      := v_subtotal + v_vat_amount;

  -- ── 6. Generate po_number ─────────────────────────────────────────────────
  v_po_number := 'PO-'
    || to_char(COALESCE(p_order_date, current_date), 'YYYYMMDD')
    || '-'
    || lpad(nextval('purchase_orders_seq')::text, 4, '0');

  -- ── 7. Insert header ──────────────────────────────────────────────────────
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

  -- ── 8. Insert line items (persist unit_factor_to_base) ────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity   := (v_item->>'quantity')::numeric;
    v_unit       := NULLIF(v_item->>'unit', '');
    v_unit_cost  := (v_item->>'unit_cost')::numeric;
    v_factor     := COALESCE((v_item->>'unit_factor_to_base')::numeric, 1);

    SELECT unit INTO v_product_unit FROM products WHERE id = v_product_id;
    v_unit := COALESCE(v_unit, v_product_unit, 'pcs');

    -- subtotal is GENERATED ALWAYS (quantity * unit_cost) — omit from column list.
    INSERT INTO purchase_order_items (
      po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base, notes
    ) VALUES (
      v_po_id, v_product_id, v_quantity, v_unit, v_unit_cost, v_factor,
      NULLIF(v_item->>'notes', '')
    );
  END LOOP;

  -- ── 9. Audit ──────────────────────────────────────────────────────────────
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'purchase_order.create', 'purchase_orders', v_po_id,
    jsonb_build_object(
      'po_number',       v_po_number,
      'supplier_id',     p_supplier_id,
      'item_count',      v_item_count,
      'subtotal',        v_subtotal,
      'vat_amount',      v_vat_amount,
      'total_amount',    v_total,
      'payment_terms',   p_payment_terms,
      'idempotency_key', p_idempotency_key,
      'rpc_version',     'v2'
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

-- RPC versioning monotone: drop the superseded v1.
DROP FUNCTION IF EXISTS create_purchase_order_v1(UUID, JSONB, DATE, DATE, TEXT, DECIMAL, TEXT, UUID);

COMMENT ON FUNCTION create_purchase_order_v2(UUID, JSONB, DATE, DATE, TEXT, DECIMAL, TEXT, UUID) IS
  'Session 46 — S46-B0. Atomic create-PO RPC. Validates supplier + items, '
  'enforces raw_material (category_type, R1/D1), persists unit_factor_to_base (R2/D5), '
  'computes subtotal/vat/total, inserts header + lines, status pending. '
  'Idempotent via p_idempotency_key. Gated by purchasing.po.create (MANAGER+).';

-- ─── GRANT + canonical 3-line REVOKE pair ────────────────────────────────────
GRANT EXECUTE ON FUNCTION create_purchase_order_v2(UUID, JSONB, DATE, DATE, TEXT, DECIMAL, TEXT, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION create_purchase_order_v2(UUID, JSONB, DATE, DATE, TEXT, DECIMAL, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_purchase_order_v2(UUID, JSONB, DATE, DATE, TEXT, DECIMAL, TEXT, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
