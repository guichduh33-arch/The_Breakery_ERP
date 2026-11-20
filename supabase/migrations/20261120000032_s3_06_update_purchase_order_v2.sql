-- S3-06 — partie 3 sur 4. Contexte et modèle : 20261120000030_s3_06_po_delivery_fee_discounts.sql.

-- ---------------------------------------------------------------------------
-- 5. update_purchase_order_v2
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.update_purchase_order_v2(p_po_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_line_disc     DECIMAL(14,2);
  v_item_count    INT := 0;
  v_new_supplier  UUID;
  v_new_exp_date  DATE;
  v_new_terms     TEXT;
  v_new_notes     TEXT;
  v_new_discount  DECIMAL(14,2);
  v_new_fee       DECIMAL(14,2);
  v_old_taxable   DECIMAL(14,2);
BEGIN
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

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_po.status <> 'pending' THEN
    RAISE EXCEPTION 'po_locked: status=%', v_po.status USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM goods_receipt_notes WHERE po_id = p_po_id LIMIT 1) THEN
    RAISE EXCEPTION 'po_locked: goods_receipt_note_exists' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM purchase_payments WHERE purchase_order_id = p_po_id LIMIT 1) THEN
    RAISE EXCEPTION 'po_locked: payment_exists' USING ERRCODE = 'P0001';
  END IF;

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
  v_new_discount := CASE
    WHEN p_patch ? 'discount_amount'
    THEN round(COALESCE((p_patch->>'discount_amount')::numeric, 0), 2)
    ELSE v_po.discount_amount
  END;
  v_new_fee      := CASE
    WHEN p_patch ? 'delivery_fee'
    THEN round(COALESCE((p_patch->>'delivery_fee')::numeric, 0), 2)
    ELSE v_po.delivery_fee
  END;

  IF v_new_supplier <> v_po.supplier_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM suppliers WHERE id = v_new_supplier AND is_active = TRUE AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  IF v_new_terms NOT IN ('cash','credit') THEN
    RAISE EXCEPTION 'invalid_payment_terms: %', v_new_terms USING ERRCODE = 'P0001';
  END IF;
  IF v_new_discount < 0 THEN
    RAISE EXCEPTION 'discount_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;
  IF v_new_fee < 0 THEN
    RAISE EXCEPTION 'delivery_fee_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

  -- Taux de PPN du bon : rapport PPN / base taxable d'origine (avant patch).
  v_old_taxable := v_po.subtotal - v_po.discount_amount;
  v_vat_rate := CASE
    WHEN v_old_taxable > 0 THEN ROUND(v_po.vat_amount / v_old_taxable, 4)
    ELSE 0.11
  END;

  IF p_patch ? 'items' AND jsonb_typeof(p_patch->'items') = 'array' THEN
    IF jsonb_array_length(p_patch->'items') = 0 THEN
      RAISE EXCEPTION 'items_required' USING ERRCODE = 'P0001';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_patch->'items') LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_unit       := NULLIF(v_item->>'unit', '');
      v_unit_cost  := (v_item->>'unit_cost')::numeric;
      v_factor     := COALESCE((v_item->>'unit_factor_to_base')::numeric, 1);
      v_line_disc  := round(COALESCE((v_item->>'discount_amount')::numeric, 0), 2);

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

      v_line_sub := round(v_quantity * v_unit_cost, 2);
      IF v_line_disc < 0 OR v_line_disc > v_line_sub THEN
        RAISE EXCEPTION 'line_discount_out_of_range: product=% discount=% line=%',
          v_product_id, v_line_disc, v_line_sub USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    DELETE FROM purchase_order_items WHERE po_id = p_po_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_patch->'items') LOOP
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity   := (v_item->>'quantity')::numeric;
      v_unit       := NULLIF(v_item->>'unit', '');
      v_unit_cost  := (v_item->>'unit_cost')::numeric;
      v_factor     := COALESCE((v_item->>'unit_factor_to_base')::numeric, 1);
      v_line_disc  := round(COALESCE((v_item->>'discount_amount')::numeric, 0), 2);

      SELECT unit INTO v_product_unit FROM products WHERE id = v_product_id;
      v_unit := COALESCE(v_unit, v_product_unit, 'pcs');

      INSERT INTO purchase_order_items (
        po_id, product_id, quantity, unit, unit_cost, unit_factor_to_base,
        discount_amount, notes
      ) VALUES (
        p_po_id, v_product_id, v_quantity, v_unit, v_unit_cost, v_factor,
        v_line_disc, NULLIF(v_item->>'notes', '')
      );
    END LOOP;
  END IF;

  -- Totaux toujours recalculés depuis les lignes en base : un patch d'escompte
  -- ou de port seul doit aussi changer le total.
  SELECT COALESCE(SUM(round(quantity * unit_cost, 2) - discount_amount), 0), COUNT(*)
    INTO v_subtotal, v_item_count
    FROM purchase_order_items WHERE po_id = p_po_id;

  IF v_new_discount > v_subtotal THEN
    RAISE EXCEPTION 'discount_exceeds_subtotal: discount=% subtotal=%',
      v_new_discount, v_subtotal USING ERRCODE = 'P0001';
  END IF;

  IF (p_patch ? 'items' AND jsonb_typeof(p_patch->'items') = 'array')
     OR p_patch ? 'discount_amount' THEN
    v_vat_amount := round((v_subtotal - v_new_discount) * v_vat_rate, 2);
  ELSE
    v_vat_amount := v_po.vat_amount;
  END IF;
  v_total_amount := v_subtotal - v_new_discount + v_vat_amount + v_new_fee;

  UPDATE purchase_orders
    SET supplier_id     = v_new_supplier,
        expected_date   = v_new_exp_date,
        payment_terms   = v_new_terms,
        notes           = v_new_notes,
        subtotal        = v_subtotal,
        discount_amount = v_new_discount,
        vat_amount      = v_vat_amount,
        delivery_fee    = v_new_fee,
        total_amount    = v_total_amount,
        updated_at      = now()
    WHERE id = p_po_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_profile,
    'po.updated',
    'purchase_orders',
    p_po_id,
    jsonb_build_object(
      'po_number',       v_po.po_number,
      'supplier_id',     v_new_supplier,
      'payment_terms',   v_new_terms,
      'subtotal',        v_subtotal,
      'discount_amount', v_new_discount,
      'vat_amount',      v_vat_amount,
      'delivery_fee',    v_new_fee,
      'total_amount',    v_total_amount,
      'item_count',      v_item_count,
      'items_patched',   (p_patch ? 'items'),
      'rpc_version',     'v2'
    )
  );

  RETURN jsonb_build_object(
    'po_id',           p_po_id,
    'po_number',       v_po.po_number,
    'subtotal',        v_subtotal,
    'discount_amount', v_new_discount,
    'vat_amount',      v_vat_amount,
    'delivery_fee',    v_new_fee,
    'total_amount',    v_total_amount,
    'item_count',      v_item_count,
    'status',          'pending'
  );
END $function$;

DROP FUNCTION public.update_purchase_order_v1(uuid, jsonb);

REVOKE EXECUTE ON FUNCTION public.update_purchase_order_v2(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_purchase_order_v2(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_purchase_order_v2(uuid, jsonb) TO authenticated, service_role;

