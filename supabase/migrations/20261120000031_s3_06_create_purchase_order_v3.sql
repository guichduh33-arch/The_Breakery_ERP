-- S3-06 — partie 2 sur 4. Contexte et modèle : 20261120000030_s3_06_po_delivery_fee_discounts.sql.

-- ---------------------------------------------------------------------------
-- 4. create_purchase_order_v3
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.create_purchase_order_v3(
  p_supplier_id uuid,
  p_items jsonb,
  p_expected_date date DEFAULT NULL::date,
  p_order_date date DEFAULT NULL::date,
  p_payment_terms text DEFAULT 'credit'::text,
  p_vat_rate numeric DEFAULT 0.11,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_discount_amount numeric DEFAULT 0,
  p_delivery_fee numeric DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_po_id        UUID;
  v_po_number    TEXT;
  v_existing     UUID;
  v_existing_no  TEXT;
  v_total_exist  DECIMAL(14,2);
  v_subtotal     DECIMAL(14,2) := 0;
  v_discount     DECIMAL(14,2) := round(COALESCE(p_discount_amount, 0), 2);
  v_fee          DECIMAL(14,2) := round(COALESCE(p_delivery_fee, 0), 2);
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
  v_line_disc    DECIMAL(14,2);
  v_product_unit TEXT;
  v_cat_type     TEXT;
BEGIN
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
  IF v_discount < 0 THEN
    RAISE EXCEPTION 'discount_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;
  IF v_fee < 0 THEN
    RAISE EXCEPTION 'delivery_fee_must_be_non_negative' USING ERRCODE = 'P0001';
  END IF;

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

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE id = p_supplier_id AND is_active = TRUE AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'supplier_not_found' USING ERRCODE = 'P0002';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
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

    v_line_sub   := round(v_quantity * v_unit_cost, 2);
    IF v_line_disc < 0 OR v_line_disc > v_line_sub THEN
      RAISE EXCEPTION 'line_discount_out_of_range: product=% discount=% line=%',
        v_product_id, v_line_disc, v_line_sub USING ERRCODE = 'P0001';
    END IF;
    v_subtotal   := v_subtotal + v_line_sub - v_line_disc;
    v_item_count := v_item_count + 1;
  END LOOP;

  IF v_discount > v_subtotal THEN
    RAISE EXCEPTION 'discount_exceeds_subtotal: discount=% subtotal=%',
      v_discount, v_subtotal USING ERRCODE = 'P0001';
  END IF;

  v_vat_amount := round((v_subtotal - v_discount) * p_vat_rate, 2);
  v_total      := v_subtotal - v_discount + v_vat_amount + v_fee;

  v_po_number := 'PO-'
    || to_char(COALESCE(p_order_date, current_date), 'YYYYMMDD')
    || '-'
    || lpad(nextval('purchase_orders_seq')::text, 4, '0');

  INSERT INTO purchase_orders (
    po_number, supplier_id, status, payment_terms,
    subtotal, discount_amount, vat_amount, delivery_fee, total_amount,
    order_date, expected_date, notes,
    idempotency_key, created_by
  ) VALUES (
    v_po_number, p_supplier_id, 'pending', p_payment_terms,
    v_subtotal, v_discount, v_vat_amount, v_fee, v_total,
    COALESCE(p_order_date, current_date), p_expected_date, p_notes,
    p_idempotency_key, v_profile
  ) RETURNING id INTO v_po_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
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
      v_po_id, v_product_id, v_quantity, v_unit, v_unit_cost, v_factor,
      v_line_disc, NULLIF(v_item->>'notes', '')
    );
  END LOOP;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'purchase_order.create', 'purchase_orders', v_po_id,
    jsonb_build_object(
      'po_number',       v_po_number,
      'supplier_id',     p_supplier_id,
      'item_count',      v_item_count,
      'subtotal',        v_subtotal,
      'discount_amount', v_discount,
      'vat_amount',      v_vat_amount,
      'delivery_fee',    v_fee,
      'total_amount',    v_total,
      'payment_terms',   p_payment_terms,
      'idempotency_key', p_idempotency_key,
      'rpc_version',     'v3'
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'po_id',             v_po_id,
    'po_number',         v_po_number,
    'subtotal',          v_subtotal,
    'discount_amount',   v_discount,
    'vat_amount',        v_vat_amount,
    'delivery_fee',      v_fee,
    'total_amount',      v_total,
    'status',            'pending',
    'item_count',        v_item_count,
    'idempotent_replay', false
  );
END $function$;

DROP FUNCTION public.create_purchase_order_v2(uuid, jsonb, date, date, text, numeric, text, uuid);

REVOKE EXECUTE ON FUNCTION public.create_purchase_order_v3(uuid, jsonb, date, date, text, numeric, text, uuid, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_purchase_order_v3(uuid, jsonb, date, date, text, numeric, text, uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_order_v3(uuid, jsonb, date, date, text, numeric, text, uuid, numeric, numeric) TO authenticated, service_role;

