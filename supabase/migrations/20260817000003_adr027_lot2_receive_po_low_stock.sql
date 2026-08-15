-- 20260817000003_adr027_lot2_receive_po_low_stock.sql
--
-- ADR-027 lot 2/3 (suite) — réception PO et alertes stock bas mono-section.
-- Corps repris du live pg_get_functiondef. Voir 20260817000002 pour l'opname.
-- NOTE ADR-004 : create_stock_lot_v1 = infra dormante péremption, verbatim.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. receive_purchase_order_v4 — sans p_section_id
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receive_purchase_order_v4(
  p_po_id uuid, p_received_items jsonb, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_base_qty        DECIMAL(14,3);
  v_base_unit_cost  DECIMAL(14,2);
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
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_received_items IS NULL
     OR jsonb_typeof(p_received_items) <> 'array'
     OR jsonb_array_length(p_received_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, grn_number INTO v_existing_grn, v_existing_no
      FROM goods_receipt_notes WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing_grn IS NOT NULL THEN
      -- Le chemin d'écriture ne stampe pas reference_type='purchase_order' :
      -- metadata->>'grn_id' est la seule clé fiable.
      SELECT COUNT(*) INTO v_movements_count
        FROM stock_movements
        WHERE metadata->>'grn_id' = v_existing_grn::text;
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

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_po.status NOT IN ('pending','partial') THEN
    RAISE EXCEPTION 'po_invalid_status: %', v_po.status USING ERRCODE = 'P0002';
  END IF;

  v_grn_id := gen_random_uuid();

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_received_items) LOOP
    v_po_item_id   := (v_item->>'po_item_id')::uuid;
    v_received_qty := (v_item->>'received_quantity')::numeric;

    IF v_po_item_id IS NULL THEN
      RAISE EXCEPTION 'po_item_id_required' USING ERRCODE = 'P0001';
    END IF;
    IF v_received_qty IS NULL OR v_received_qty <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive' USING ERRCODE = 'P0001';
    END IF;

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

    SELECT id, unit, default_shelf_life_hours
      INTO v_product
      FROM products
      WHERE id = v_po_item.product_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Convert BOTH quantity AND unit cost to the base unit.
    v_base_qty := round(v_received_qty * v_po_item.unit_factor_to_base, 10);
    v_base_unit_cost := CASE
      WHEN v_po_item.unit_cost IS NULL THEN NULL
      ELSE round(v_po_item.unit_cost / NULLIF(v_po_item.unit_factor_to_base, 0), 2)
    END;

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
        'supplier_id', v_po.supplier_id
      );
      v_lot_id := (create_stock_lot_v1(
        p_product_id      := v_product.id,
        p_quantity        := v_base_qty,
        p_unit            := v_product.unit,
        p_location_id     := NULL,
        p_expires_at      := NULL,
        p_batch_number    := v_po.po_number || '-' || v_po_item_id::text,
        p_idempotency_key := v_lot_idem_key,
        p_metadata        := v_lot_metadata
      )->>'lot_id')::uuid;
    END IF;

    v_mv_idem_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':mv:' || v_po_item_id::text)::uuid
    END;

    v_mv_result := record_stock_movement_v1(
      p_product_id      := v_product.id,
      p_movement_type   := 'purchase',
      p_quantity        := v_base_qty,
      p_reason          := 'Receipt against PO ' || v_po.po_number,
      p_unit_cost       := v_base_unit_cost,
      p_supplier_id     := v_po.supplier_id,
      p_idempotency_key := v_mv_idem_key,
      p_unit            := v_product.unit,
      p_from_section_id := NULL,
      p_to_section_id   := NULL,
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

    UPDATE purchase_order_items
      SET received_quantity = received_quantity + v_received_qty,
          updated_at        = now()
      WHERE id = v_po_item_id;

    v_grn_subtotal := v_grn_subtotal + round(v_received_qty * v_po_item.unit_cost, 2);
  END LOOP;

  IF v_po.subtotal > 0 THEN
    v_grn_vat := round(v_po.vat_amount * (v_grn_subtotal / v_po.subtotal), 2);
  ELSE
    v_grn_vat := 0;
  END IF;
  v_grn_total := v_grn_subtotal + v_grn_vat;

  v_grn_number := 'GRN-'
    || to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')
    || '-'
    || lpad(nextval('goods_receipt_notes_seq')::text, 4, '0');

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
      'lines',       jsonb_array_length(p_received_items)
    )
  );

  SELECT id INTO v_je_id FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = v_grn_id LIMIT 1;

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
      'rpc_version',     'v4'
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
END $function$;

COMMENT ON FUNCTION public.receive_purchase_order_v4(uuid, jsonb, uuid) IS
  'ADR-027 : réception PO mono-section (plus de p_section_id). '
  'purchasing.po.receive. Idempotent via p_idempotency_key (GRN + mouvements).';

DROP FUNCTION IF EXISTS public.receive_purchase_order_v3(uuid, uuid, jsonb, uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. get_low_stock_v2 — global uniquement
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_low_stock_v2()
 RETURNS TABLE(
   product_id uuid, product_sku text, product_name text,
   current_qty numeric, min_stock_threshold numeric, unit text, shortfall numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.sku, p.name,
    p.current_stock, p.min_stock_threshold, p.unit,
    (p.min_stock_threshold - p.current_stock) AS shortfall
  FROM products p
  WHERE p.deleted_at IS NULL
    AND p.is_active = true
    AND p.min_stock_threshold > 0
    AND p.current_stock < p.min_stock_threshold
  ORDER BY (p.min_stock_threshold - p.current_stock) DESC, p.name;
END $function$;

COMMENT ON FUNCTION public.get_low_stock_v2() IS
  'ADR-027 : alertes stock bas sur le stock global uniquement (inventory.read).';

DROP FUNCTION IF EXISTS public.get_low_stock_v1(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Paires REVOKE S25 (anon hérite EXECUTE via PUBLIC) + GRANT authenticated
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.receive_purchase_order_v4(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_low_stock_v2()                           FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.receive_purchase_order_v4(uuid, jsonb, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_low_stock_v2()                            TO authenticated;
