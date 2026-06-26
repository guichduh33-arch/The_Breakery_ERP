-- 20260710000021_record_stock_movement_v1_allow_negative.sql
-- Ajoute p_allow_negative au primitive record_stock_movement_v1 : permet aux
-- flux production (production_out) de laisser le stock passer en négatif quand
-- business_config.allow_negative_stock est ON. Les appelants existants (wrappers
-- adjust/receive/waste/transfer + record_production) utilisent des paramètres
-- nommés → le défaut false conserve le comportement actuel.
--
-- Le corps est repris VERBATIM de la def live 12-arg (section_stock + lots S17),
-- avec exactement deux changements : (1) nouveau dernier paramètre
-- p_allow_negative BOOLEAN DEFAULT false ; (2) le garde négatif tient compte du
-- flag. DROP de la signature 12-arg puis CREATE 13-arg (un param optionnel via
-- CREATE OR REPLACE créerait une surcharge → ambiguïté REVOKE).

DROP FUNCTION IF EXISTS public.record_stock_movement_v1(
  uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid
);

CREATE OR REPLACE FUNCTION public.record_stock_movement_v1(
  p_product_id uuid,
  p_movement_type movement_type,
  p_quantity numeric,
  p_reason text,
  p_unit_cost numeric DEFAULT NULL::numeric,
  p_supplier_id uuid DEFAULT NULL::uuid,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_unit text DEFAULT NULL::text,
  p_from_section_id uuid DEFAULT NULL::uuid,
  p_to_section_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_lot_id uuid DEFAULT NULL::uuid,
  p_allow_negative boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_current  DECIMAL(10,3);
  v_new      DECIMAL(10,3);
  v_mvt_id   UUID;
  v_unit     TEXT;
  v_lot_id   UUID := p_lot_id;
  v_remain   DECIMAL(10,3);
  v_lot_table_exists BOOLEAN;
BEGIN
  IF p_movement_type IN ('sale', 'sale_void') THEN
    RAISE EXCEPTION 'record_stock_movement_v1 cannot be called with movement_type=%', p_movement_type;
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'quantity_must_be_nonzero';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM stock_movements WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_new FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'movement_id', v_mvt_id, 'product_id', p_product_id,
        'new_current_stock', v_new, 'idempotent_replay', true,
        'lot_id', (SELECT lot_id FROM stock_movements WHERE id = v_mvt_id));
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    -- Audit 2026-06-12 C2 : contexte serveur de confiance (pg_cron tourne en
    -- 'postgres', auth.uid() NULL). PostgREST se connecte en 'authenticator'
    -- → anon/authenticated n'atteignent jamais cette branche.
    IF v_uid IS NULL AND session_user = 'postgres' THEN
      v_profile := '00000000-0000-0000-0000-000000000999';  -- SYSTEM (cron)
    ELSE
      RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
    END IF;
  END IF;

  SELECT current_stock, unit INTO v_current, v_unit FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_unit := COALESCE(p_unit, v_unit, 'pcs');
  v_new := v_current + p_quantity;
  -- Negative-stock guard : désactivable via p_allow_negative (flux production
  -- quand business_config.allow_negative_stock est ON).
  IF v_new < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'stock_lots' AND n.nspname = 'public'
  ) INTO v_lot_table_exists;

  IF v_lot_table_exists
     AND p_movement_type IN ('waste','transfer_out','production_out')
     AND v_lot_id IS NULL
     AND p_quantity < 0
  THEN
    EXECUTE $exec$
      SELECT id, quantity FROM stock_lots
        WHERE product_id = $1 AND status = 'active' AND quantity > 0
        ORDER BY expires_at ASC NULLS LAST, created_at ASC
        LIMIT 1 FOR UPDATE
    $exec$ INTO v_lot_id, v_remain USING p_product_id;

    IF v_lot_id IS NOT NULL THEN
      EXECUTE $exec$
        UPDATE stock_lots
          SET quantity = quantity + $2,
              status = CASE WHEN quantity + $2 <= 0 THEN 'consumed' ELSE status END,
              updated_at = now()
          WHERE id = $1
      $exec$ USING v_lot_id, p_quantity;
    END IF;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, created_by,
    from_section_id, to_section_id, metadata, lot_id
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, 'admin_action', v_profile,
    p_from_section_id, p_to_section_id, COALESCE(p_metadata, '{}'::JSONB), v_lot_id
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  IF p_quantity < 0 AND p_from_section_id IS NOT NULL THEN
    INSERT INTO section_stock (section_id, product_id, quantity, unit)
      VALUES (p_from_section_id, p_product_id, p_quantity, v_unit)
      ON CONFLICT (section_id, product_id) DO UPDATE
        SET quantity = section_stock.quantity + EXCLUDED.quantity, updated_at = now();
  ELSIF p_quantity > 0 AND p_to_section_id IS NOT NULL THEN
    INSERT INTO section_stock (section_id, product_id, quantity, unit)
      VALUES (p_to_section_id, p_product_id, p_quantity, v_unit)
      ON CONFLICT (section_id, product_id) DO UPDATE
        SET quantity = section_stock.quantity + EXCLUDED.quantity, updated_at = now();
  END IF;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES ('stock.movement', 'stock_movements', v_mvt_id,
    jsonb_build_object(
      'movement_type', p_movement_type, 'quantity', p_quantity, 'unit', v_unit,
      'reason', p_reason, 'new_current_stock', v_new, 'idempotency_key', p_idempotency_key,
      'from_section_id', p_from_section_id, 'to_section_id', p_to_section_id,
      'metadata', COALESCE(p_metadata, '{}'::JSONB), 'lot_id', v_lot_id,
      'allow_negative', p_allow_negative),
    v_profile);

  RETURN jsonb_build_object(
    'movement_id', v_mvt_id, 'product_id', p_product_id,
    'new_current_stock', v_new, 'idempotent_replay', false, 'lot_id', v_lot_id);
END $function$;

-- INTERNAL primitive : jamais appelable directement par anon/authenticated.
REVOKE ALL ON FUNCTION public.record_stock_movement_v1(
  uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_stock_movement_v1(
  uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean
) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_stock_movement_v1(
  uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean
) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.record_stock_movement_v1(
  uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean
) IS
  'INTERNAL primitive — only callable by other SECURITY DEFINER functions. '
  '+ p_allow_negative (défaut false) : désactive le garde négatif pour les flux '
  'production quand business_config.allow_negative_stock est ON.';
