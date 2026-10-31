-- Corps de départ lus par pg_get_functiondef sur V3 dev le 31 octobre 2026.
ALTER TABLE public.inventory_count_items ADD COLUMN counted_by uuid REFERENCES public.user_profiles(id);
ALTER TABLE public.inventory_counts ADD COLUMN business_day date;
CREATE OR REPLACE FUNCTION public.add_opname_item_v3(p_count_id uuid, p_product_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_status        TEXT;
  v_product_unit  TEXT;
  v_current_stock DECIMAL(10,3);
  v_expected      DECIMAL(10,3);
  v_item_id       UUID;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.opname.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT status INTO v_status
    FROM inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_status NOT IN ('draft','counting') THEN
    RAISE EXCEPTION 'add_item_not_allowed_in_status';
  END IF;

  SELECT unit, current_stock INTO v_product_unit, v_current_stock
    FROM products WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  -- ADR-027 : l'attendu est le stock global — celui que la finalisation corrige.
  v_expected := COALESCE(v_current_stock, 0);

  INSERT INTO inventory_count_items (
    count_id, product_id, expected_qty, unit, notes
  ) VALUES (
    p_count_id, p_product_id, v_expected, COALESCE(v_product_unit, 'pcs'), p_notes
  )
  ON CONFLICT (count_id, product_id) DO UPDATE
    SET expected_qty = EXCLUDED.expected_qty,
        unit         = EXCLUDED.unit,
        notes        = EXCLUDED.notes,
        updated_at   = now()
  RETURNING id INTO v_item_id;

  IF v_status = 'draft' THEN
    UPDATE inventory_counts SET status = 'counting' WHERE id = p_count_id;
  END IF;

  RETURN jsonb_build_object(
    'item_id',      v_item_id,
    'count_id',     p_count_id,
    'product_id',   p_product_id,
    'expected_qty', CASE WHEN is_business_owner_v1() THEN v_expected ELSE NULL END,
    'unit',         COALESCE(v_product_unit, 'pcs')
  );
END $function$;

DROP FUNCTION public.add_opname_item_v2(uuid,uuid,numeric,text);
CREATE OR REPLACE FUNCTION public.finalize_opname_v5(p_count_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_status        TEXT;
  v_count_number  TEXT;
  v_item          RECORD;
  v_movement      JSONB;
  v_movement_id   UUID;
  v_mvt_type      TEXT;
  v_qty           DECIMAL(10,3);
  v_movements     JSONB := '[]'::JSONB;
  v_emitted       INT := 0;
BEGIN
  IF NOT is_business_owner_v1() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT status, count_number
    INTO v_status, v_count_number
    FROM inventory_counts WHERE id = p_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'count_not_found' USING ERRCODE='P0002';
  END IF;

  IF EXISTS(SELECT 1 FROM inventory_count_items WHERE count_id=p_count_id
     AND (counted_by=v_profile OR counted_by IS NULL)) THEN
    RAISE EXCEPTION 'independent_approver_required' USING ERRCODE='P0003';
  END IF;

  IF v_status = 'finalized' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'movement_id', sm.id,
            'product_id',  sm.product_id,
            'movement_type', sm.movement_type,
            'quantity',    sm.quantity,
            'unit',        sm.unit
          ) ORDER BY sm.created_at), '[]'::JSONB)
      INTO v_movements
      FROM stock_movements sm
      WHERE sm.reference_type = 'opname' AND sm.reference_id = p_count_id;
    RETURN jsonb_build_object(
      'count_id',          p_count_id,
      'count_number',      v_count_number,
      'status',            'finalized',
      'idempotent_replay', true,
      'movements_emitted', jsonb_array_length(v_movements),
      'movements',         v_movements
    );
  END IF;

  IF v_status <> 'review' THEN
    RAISE EXCEPTION 'finalize_not_allowed_in_status';
  END IF;

  IF EXISTS(SELECT 1 FROM inventory_count_items WHERE count_id=p_count_id AND counted_by IS NULL) THEN
    RAISE EXCEPTION 'counter_identity_required';
  END IF;

  IF EXISTS (SELECT 1 FROM inventory_count_items
              WHERE count_id = p_count_id AND counted_qty IS NULL) THEN
    RAISE EXCEPTION 'missing_counts';
  END IF;

  FOR v_item IN
    SELECT ici.id, ici.product_id, ici.variance, ici.unit, ici.expected_qty, ici.counted_qty
      FROM inventory_count_items ici
      WHERE ici.count_id = p_count_id AND COALESCE(ici.variance, 0) <> 0
  LOOP
    v_qty := ABS(v_item.variance);
    IF v_item.variance > 0 THEN
      v_mvt_type := 'opname_in';
    ELSE
      v_mvt_type := 'opname_out';
    END IF;

    v_movement := record_stock_movement_v1(
      p_product_id      := v_item.product_id,
      p_movement_type   := v_mvt_type::movement_type,
      p_quantity        := CASE WHEN v_item.variance > 0 THEN v_qty ELSE -v_qty END,
      p_reason          := 'Opname ' || v_count_number || ' variance '
                           || CASE WHEN v_item.variance > 0 THEN '+' ELSE '-' END || v_qty,
      p_unit_cost       := NULL,
      p_supplier_id     := NULL,
      p_idempotency_key := NULL,
      p_unit            := v_item.unit,
      p_from_section_id := NULL,
      p_to_section_id   := NULL,
      p_metadata        := jsonb_build_object(
                             'reference_type', 'opname',
                             'reference_id',   p_count_id,
                             'count_id',       p_count_id,
                             'count_number',   v_count_number,
                             'count_item_id',  v_item.id,
                             'expected_qty',   v_item.expected_qty,
                             'counted_qty',    v_item.counted_qty
                           ),
      p_lot_id          := NULL
    );

    v_movement_id := (v_movement->>'movement_id')::UUID;

    UPDATE inventory_count_items
      SET movement_id = v_movement_id, updated_at = now()
      WHERE id = v_item.id;

    v_movements := v_movements || jsonb_build_array(jsonb_build_object(
      'movement_id',   v_movement_id,
      'product_id',    v_item.product_id,
      'movement_type', v_mvt_type,
      'variance',      v_item.variance,
      'quantity',      v_qty,
      'unit',          v_item.unit
    ));
    v_emitted := v_emitted + 1;
  END LOOP;

  UPDATE inventory_counts
    SET status           = 'finalized',
        finalized_by     = v_profile,
        finalized_at     = now(),
        idempotency_key  = COALESCE(idempotency_key, p_idempotency_key),
        metadata         = metadata || jsonb_build_object(
                                         'movements_emitted', v_emitted,
                                         'finalized_at',      now()
                                       )
    WHERE id = p_count_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'opname.finalize', 'inventory_counts', p_count_id,
    jsonb_build_object(
      'count_number',      v_count_number,
      'movements_emitted', v_emitted,
      'idempotency_key',   p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'count_id',          p_count_id,
    'count_number',      v_count_number,
    'status',            'finalized',
    'idempotent_replay', false,
    'movements_emitted', v_emitted,
    'movements',         v_movements
  );
END $function$;

DROP FUNCTION public.finalize_opname_v4(uuid,uuid);
-- Une lecture directe ne peut pas exposer des colonnes masquées selon le rôle.
CREATE POLICY count_items_owner_only ON public.inventory_count_items AS RESTRICTIVE
 FOR SELECT TO authenticated USING(public.is_business_owner_v1());

CREATE FUNCTION public.get_opname_items_v1(p_count_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT has_permission(auth.uid(),'inventory.read') THEN
   RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
 END IF;
 RETURN COALESCE((SELECT jsonb_agg(
   (to_jsonb(i)-'expected_qty'-'variance')||jsonb_build_object(
     'expected_qty',CASE WHEN is_business_owner_v1() THEN i.expected_qty ELSE NULL END,
     'variance',CASE WHEN is_business_owner_v1() THEN i.variance ELSE NULL END,
     'product',jsonb_build_object('sku',p.sku,'name',p.name))
   ORDER BY i.created_at,i.id)
 FROM inventory_count_items i JOIN products p ON p.id=i.product_id WHERE i.count_id=p_count_id),'[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.add_opname_item_v3(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.finalize_opname_v5(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_opname_items_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_opname_item_v3(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_opname_v5(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_opname_items_v1(uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

