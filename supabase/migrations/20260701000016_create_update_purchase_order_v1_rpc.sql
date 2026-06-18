-- 20260701000016_create_update_purchase_order_v1_rpc.sql
-- Session 46 / Wave A6 — update_purchase_order_v1 RPC.
--
-- R4 (Spec §3): edit PO header and line items.
-- D3 + D6 (spec §2): editable ONLY when status='pending' AND no GRN exists
-- AND no payment exists. Lock is checked atomically inside the transaction.
--
-- Patch contract:
--   p_patch JSONB may contain:
--     header allowlist: supplier_id (uuid), expected_date (date as ISO text),
--                       payment_terms ('cash'|'credit'), notes (text)
--     items: p_patch->'items' (JSONB array, replaces ALL existing items)
--       each item: { product_id (uuid), quantity (numeric),
--                    unit (text), unit_cost (numeric),
--                    unit_factor_to_base (numeric, optional, default 1) }
--       items must be raw_material (category_type = 'raw_material', D1).
--
-- Totals are always recomputed from the final item set.
-- Idempotency: this RPC is deterministic on the patch; callers may simply retry.
-- Canonical REVOKE pair at end.

CREATE OR REPLACE FUNCTION update_purchase_order_v1(
  p_po_id  UUID,
  p_patch  JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_po            RECORD;
  v_item          JSONB;
  v_product_id    UUID;
  v_quantity      DECIMAL(14,3);
  v_unit          TEXT;
  v_unit_cost     DECIMAL(14,2);
  v_factor        NUMERIC(20,10);
  v_product_unit  TEXT;
  v_cat_type      TEXT;
  v_subtotal      DECIMAL(14,2) := 0;
  v_vat_rate      DECIMAL(6,4);
  v_vat_amount    DECIMAL(14,2);
  v_total_amount  DECIMAL(14,2);
  v_line_sub      DECIMAL(14,2);
  v_item_count    INT := 0;
  v_new_supplier  UUID;
  v_new_exp_date  DATE;
  v_new_terms     TEXT;
  v_new_notes     TEXT;
BEGIN
  -- ── 1. Auth-first ─────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.edit') THEN
    RAISE EXCEPTION 'permission_denied: purchasing.po.edit' USING ERRCODE = 'P0003';
  END IF;

  -- ── 2. Validate p_po_id ────────────────────────────────────────────────────
  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;

  -- ── 3. Lock PO row ────────────────────────────────────────────────────────
  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- ── 4. Lock guards (D3 + D6) ──────────────────────────────────────────────
  -- Lock if: status <> 'pending' OR any GRN exists OR any payment exists.
  IF v_po.status <> 'pending' THEN
    RAISE EXCEPTION 'po_locked: status=%', v_po.status USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM goods_receipt_notes WHERE po_id = p_po_id LIMIT 1) THEN
    RAISE EXCEPTION 'po_locked: goods_receipt_note_exists' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_payments WHERE purchase_order_id = p_po_id LIMIT 1) THEN
    RAISE EXCEPTION 'po_locked: payment_exists' USING ERRCODE = 'P0001';
  END IF;

  -- ── 5. Apply header patch (allowlist only) ────────────────────────────────
  v_new_supplier := COALESCE((p_patch->>'supplier_id')::uuid, v_po.supplier_id);
  v_new_exp_date := CASE
    WHEN p_patch ? 'expected_date' AND p_patch->>'expected_date' IS NOT NULL
    THEN (p_patch->>'expected_date')::date
    ELSE v_po.expected_date
  END;
  v_new_terms    := COALESCE(NULLIF(p_patch->>'payment_terms',''), v_po.payment_terms);
  v_new_notes    := CASE
    WHEN p_patch ? 'notes' THEN p_patch->>'notes'
    ELSE v_po.notes
  END;

  -- Validate supplier if changed.
  IF v_new_supplier <> v_po.supplier_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM suppliers WHERE id = v_new_supplier AND is_active = TRUE AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Validate payment_terms.
  IF v_new_terms NOT IN ('cash','credit') THEN
    RAISE EXCEPTION 'invalid_payment_terms: %', v_new_terms USING ERRCODE = 'P0001';
  END IF;

  -- ── 6. Replace line items (if p_patch contains 'items') ───────────────────
  IF p_patch ? 'items' AND jsonb_typeof(p_patch->'items') = 'array' THEN
    IF jsonb_array_length(p_patch->'items') = 0 THEN
      RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
    END IF;

    -- Validate each new item.
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_patch->'items') LOOP
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

      v_unit := COALESCE(v_unit, v_product_unit, 'pcs');
      v_line_sub  := round(v_quantity * v_unit_cost, 2);
      v_subtotal  := v_subtotal + v_line_sub;
      v_item_count := v_item_count + 1;
    END LOOP;

    -- Derive VAT rate from existing PO (keep same rate — no re-prompt for VAT).
    -- Compute from existing vat_amount / subtotal if subtotal > 0, else 0.11 default.
    v_vat_rate := CASE
      WHEN v_po.subtotal > 0 THEN ROUND(v_po.vat_amount / v_po.subtotal, 4)
      ELSE 0.11
    END;
    v_vat_amount   := round(v_subtotal * v_vat_rate, 2);
    v_total_amount := v_subtotal + v_vat_amount;

    -- Delete existing line items; re-insert from patch.
    DELETE FROM purchase_order_items WHERE po_id = p_po_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_patch->'items') LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_unit       := NULLIF(v_item->>'unit', '');
      v_unit_cost  := (v_item->>'unit_cost')::numeric;
      v_factor     := COALESCE((v_item->>'unit_factor_to_base')::numeric, 1);

      SELECT unit INTO v_product_unit FROM products WHERE id = v_product_id;
      v_unit     := COALESCE(v_unit, v_product_unit, 'pcs');
      -- v_line_sub already computed in the validation loop above; recompute here
      -- for clarity (the validation loop runs first pass, this runs second pass).
      v_line_sub := round(v_quantity * v_unit_cost, 2);

      -- C3: purchase_order_items.subtotal is GENERATED ALWAYS AS (quantity * unit_cost) STORED
      -- (migration _init_purchase_orders.sql §3) — PostgreSQL computes it automatically
      -- from quantity + unit_cost which are both NOT NULL. It cannot be NULL and must NOT
      -- be listed in the INSERT column list (would raise "can only be updated to DEFAULT").
      INSERT INTO purchase_order_items (
        po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base, notes
      ) VALUES (
        p_po_id, v_product_id, v_quantity, v_unit, v_unit_cost, v_factor,
        NULLIF(v_item->>'notes', '')
      );
    END LOOP;

  ELSE
    -- No items patch: totals stay as-is.
    v_subtotal     := v_po.subtotal;
    v_vat_amount   := v_po.vat_amount;
    v_total_amount := v_po.total_amount;
    v_item_count   := (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = p_po_id);
  END IF;

  -- ── 7. Update PO header ────────────────────────────────────────────────────
  UPDATE purchase_orders
    SET supplier_id   = v_new_supplier,
        expected_date = v_new_exp_date,
        payment_terms = v_new_terms,
        notes         = v_new_notes,
        subtotal      = v_subtotal,
        vat_amount    = v_vat_amount,
        total_amount  = v_total_amount,
        updated_at    = now()
    WHERE id = p_po_id;

  -- ── 8. Audit ──────────────────────────────────────────────────────────────
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile,
    'po.updated',
    'purchase_orders',
    p_po_id,
    jsonb_build_object(
      'po_number',    v_po.po_number,
      'supplier_id',  v_new_supplier,
      'payment_terms', v_new_terms,
      'subtotal',     v_subtotal,
      'vat_amount',   v_vat_amount,
      'total_amount', v_total_amount,
      'item_count',   v_item_count,
      'items_patched', (p_patch ? 'items'),
      'rpc_version',  'v1'
    )
  );

  RETURN jsonb_build_object(
    'po_id',        p_po_id,
    'po_number',    v_po.po_number,
    'subtotal',     v_subtotal,
    'vat_amount',   v_vat_amount,
    'total_amount', v_total_amount,
    'item_count',   v_item_count,
    'status',       'pending'
  );
END $$;

COMMENT ON FUNCTION update_purchase_order_v1(UUID, JSONB) IS
  'Session 46 — S46-A6. Edit a pending PO header + line items. '
  'Gate: purchasing.po.edit. Lock guard: rejects if status<>pending OR GRN exists '
  'OR payment exists (po_locked P0001). Header allowlist: supplier_id, expected_date, '
  'payment_terms, notes. Items: replaces ALL lines (D1 raw_material check). '
  'Recomputes subtotal/vat_amount/total_amount. Audit: po.updated.';

-- ─── GRANT + canonical 3-line REVOKE pair ────────────────────────────────────
GRANT EXECUTE ON FUNCTION update_purchase_order_v1(UUID, JSONB) TO authenticated;
REVOKE EXECUTE ON FUNCTION update_purchase_order_v1(UUID, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_purchase_order_v1(UUID, JSONB) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
