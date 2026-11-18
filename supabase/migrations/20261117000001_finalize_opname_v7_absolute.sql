-- S1-10 — l'inventaire pose le stock à la quantité comptée (ADR-038).
--
-- Corps de départ : `finalize_opname_v6`, lu par pg_get_functiondef le
-- 2026-11-17, identique en dev et en production (md5 1b922d26…).
--
-- Deux changements, rien d'autre :
--   1. Le mouvement émis vaut `counted_qty - current_stock` lu SOUS VERROU au
--      moment de la finalisation, et non plus l'écart figé à l'ajout de la
--      ligne. Une vente, une perte ou une production survenue pendant le
--      comptage n'est donc plus comptée deux fois : le stock finit égal à la
--      quantité comptée. L'écart d'origine (`variance`) reste dans la ligne et
--      dans les métadonnées du mouvement.
--   2. Le refus `independent_approver_required` disparaît : le propriétaire
--      finalise un inventaire qu'il a compté lui-même. La séparation des tâches
--      quitte l'inventaire, en connaissance de cause (ADR-038).
--
-- Les produits sont verrouillés dans l'ordre de leur id : deux finalisations
-- concurrentes ne s'interbloquent pas.
--
-- Additif : `finalize_opname_v6` reste en place tant que le back-office publié
-- l'appelle. Son retrait suit la publication du back-office, dans une
-- migration à part.

CREATE OR REPLACE FUNCTION public.finalize_opname_v7(p_count_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
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
  v_stock_before  NUMERIC;
  v_delta         NUMERIC;
  v_qty           NUMERIC;
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
      WHERE ici.count_id = p_count_id
      ORDER BY ici.product_id
  LOOP
    SELECT COALESCE(current_stock, 0) INTO v_stock_before
      FROM products WHERE id = v_item.product_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
    END IF;

    v_delta := v_item.counted_qty - v_stock_before;
    CONTINUE WHEN v_delta = 0;

    v_qty := ABS(v_delta);
    IF v_delta > 0 THEN
      v_mvt_type := 'opname_in';
    ELSE
      v_mvt_type := 'opname_out';
    END IF;

    v_movement := record_stock_movement_v2(
      p_product_id      := v_item.product_id,
      p_movement_type   := v_mvt_type::movement_type,
      p_quantity        := v_delta,
      p_reason          := 'Opname ' || v_count_number || ' set to ' || v_item.counted_qty
                           || ' (was ' || v_stock_before || ')',
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
                             'counted_qty',    v_item.counted_qty,
                             'count_variance', v_item.variance,
                             'stock_before',   v_stock_before,
                             'applied_delta',  v_delta
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
      'stock_before',  v_stock_before,
      'counted_qty',   v_item.counted_qty,
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
                                         'finalized_at',      now(),
                                         'applied_mode',      'absolute'
                                       )
    WHERE id = p_count_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'opname.finalize', 'inventory_counts', p_count_id,
    jsonb_build_object(
      'count_number',      v_count_number,
      'movements_emitted', v_emitted,
      'idempotency_key',   p_idempotency_key,
      'applied_mode',      'absolute'
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

ALTER FUNCTION public.finalize_opname_v7(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_opname_v7(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_opname_v7(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.finalize_opname_v7(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_opname_v7(uuid, uuid) TO service_role;
