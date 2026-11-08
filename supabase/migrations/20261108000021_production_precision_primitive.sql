-- Correctif de précision des consommations de production, 8 novembre 2026.
-- Source live production V3 capturée avant édition ; ce fichier appartient au
-- paquet atomique 20261108000020.. : ne pas appliquer ses parties séparément.

DO $batch_guard$ BEGIN
  IF current_setting('breakery.production_precision_batch', true) IS DISTINCT FROM 'started' THEN
    RAISE EXCEPTION 'production_precision_atomic_batch_required';
  END IF;
END $batch_guard$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.record_stock_movement_v2(p_product_id uuid, p_movement_type movement_type, p_quantity numeric, p_reason text, p_unit_cost numeric DEFAULT NULL::numeric, p_supplier_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid, p_unit text DEFAULT NULL::text, p_from_section_id uuid DEFAULT NULL::uuid, p_to_section_id uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb, p_lot_id uuid DEFAULT NULL::uuid, p_allow_negative boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid(); v_profile UUID; v_current NUMERIC; v_new NUMERIC;
  v_mvt_id UUID; v_unit TEXT; v_lot_id UUID := p_lot_id; v_remain NUMERIC;
  v_lot_table_exists BOOLEAN; v_meta JSONB := COALESCE(p_metadata, '{}'::JSONB);
  v_ref_type TEXT; v_ref_id UUID; v_quantity NUMERIC;
BEGIN
  -- Une seule quantification effective avant gardes, ledger et cache.
  v_quantity := round(p_quantity, 9);
  IF p_quantity <> 0 AND v_quantity = 0 THEN
    RAISE EXCEPTION 'quantity_below_stock_precision' USING ERRCODE = 'P0001';
  END IF;
  p_quantity := v_quantity;
  IF p_movement_type IN ('sale', 'sale_void') THEN
    RAISE EXCEPTION 'record_stock_movement_v2 cannot be called with movement_type=%', p_movement_type;
  END IF;
  IF p_quantity = 0 THEN RAISE EXCEPTION 'quantity_must_be_nonzero'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;

  -- La référence voyage dans les métadonnées et reste posée dès l insertion.
  v_ref_type := COALESCE(NULLIF(TRIM(COALESCE(v_meta->>'reference_type', '')), ''), 'admin_action');
  BEGIN
    v_ref_id := NULLIF(TRIM(COALESCE(v_meta->>'reference_id', '')), '')::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid_reference_id: %', v_meta->>'reference_id' USING ERRCODE = 'P0002';
  END;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM stock_movements WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_new FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object('movement_id', v_mvt_id, 'product_id', p_product_id,
        'new_current_stock', v_new, 'idempotent_replay', true,
        'lot_id', (SELECT lot_id FROM stock_movements WHERE id = v_mvt_id));
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    IF v_uid IS NULL AND session_user = 'postgres' THEN
      v_profile := '00000000-0000-0000-0000-000000000999';  -- SYSTEM (cron)
    ELSE RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
  END IF;

  SELECT current_stock, unit INTO v_current, v_unit FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002'; END IF;

  v_unit := COALESCE(p_unit, v_unit, 'pcs');
  v_new := v_current + p_quantity;
  IF v_new < 0 AND NOT p_allow_negative THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002'; END IF;

  SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'stock_lots' AND n.nspname = 'public') INTO v_lot_table_exists;

  IF v_lot_table_exists AND p_movement_type IN ('waste','transfer_out','production_out')
     AND v_lot_id IS NULL AND p_quantity < 0 THEN
    EXECUTE $exec$ SELECT id, quantity FROM stock_lots WHERE product_id = $1 AND status = 'active'
        AND quantity > 0 ORDER BY expires_at ASC NULLS LAST, created_at ASC LIMIT 1 FOR UPDATE $exec$
      INTO v_lot_id, v_remain USING p_product_id;
    IF v_lot_id IS NOT NULL THEN
      EXECUTE $exec$ UPDATE stock_lots SET quantity = quantity + $2,
              status = CASE WHEN quantity + $2 <= 0 THEN 'consumed' ELSE status END,
              updated_at = now() WHERE id = $1 $exec$ USING v_lot_id, p_quantity;
    END IF;
  END IF;

  -- ADR-027 : le ledger n enregistre plus de section.
  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, reference_id, created_by,
    from_section_id, to_section_id, metadata, lot_id
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, v_ref_type, v_ref_id, v_profile,
    NULL, NULL, v_meta, v_lot_id
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES ('stock.movement', 'stock_movements', v_mvt_id,
    jsonb_build_object('movement_type', p_movement_type, 'quantity', p_quantity, 'unit', v_unit,
      'reason', p_reason, 'new_current_stock', v_new, 'idempotency_key', p_idempotency_key,
      'metadata', v_meta, 'lot_id', v_lot_id, 'allow_negative', p_allow_negative), v_profile);

  RETURN jsonb_build_object('movement_id', v_mvt_id, 'product_id', p_product_id,
    'new_current_stock', v_new, 'idempotent_replay', false, 'lot_id', v_lot_id);
END $function$;
ALTER FUNCTION public.record_stock_movement_v2(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_stock_movement_v2(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_stock_movement_v2(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean) TO postgres;
GRANT EXECUTE ON FUNCTION public.record_stock_movement_v2(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean) TO service_role;
COMMENT ON FUNCTION public.record_stock_movement_v2(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean) IS 'Primitive d ecriture du ledger. Depuis F2 (2026-09-08), lit reference_type et reference_id dans p_metadata et les pose A L INSERTION — c est ce qui permet a finalize_opname de ne plus faire d UPDATE sur un ledger append-only. Sans metadonnee, reference_type retombe sur admin_action (comportement anterieur). Toute nouvelle RPC qui ecrit le ledger passe par ici — jamais un INSERT direct, jamais un UPDATE.';
DROP FUNCTION public.record_stock_movement_v1(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean);
