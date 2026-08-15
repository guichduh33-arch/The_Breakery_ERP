-- 20260817000002_adr027_lot2_opname_global.sql
--
-- ADR-027 lot 2/3 — les flux d'écriture deviennent mono-section.
--
-- * Opname global : create/add_item/finalize bumpent en _v2 (corps repris du
--   live pg_get_functiondef). La création ne prend plus de section ; l'attendu
--   d'une ligne se lit sur products.current_stock (le stock qui fait autorité)
--   et non plus sur le cache section_stock ; la finalisation émet ses mouvements
--   sans section. set/validate/cancel_opname_v1 sont sans logique de section et
--   ne bougent pas. inventory_counts.section_id devient nullable (l'historique
--   conserve sa section d'époque).
-- * Réception PO : receive_purchase_order_v4 sans p_section_id (couvre aussi le
--   flux « achat direct » du BO qui enchaîne create_purchase_order_v2 + receive).
-- * get_low_stock_v2 : mode global uniquement (la branche per-section lisait
--   section_stock, condamnée au lot 3).
-- * Production : PAS de bump (écart assumé vs ADR-027 conséq. 5, amendée dans le
--   même commit) — p_section_id y désigne la STATION, conservée sur
--   production_records ; la primitive ignore désormais les sections côté ledger.
--
-- NOTE ADR-004 : create_stock_lot_v1 dans la réception = infra dormante
-- péremption, reprise verbatim.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. inventory_counts.section_id nullable
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_counts ALTER COLUMN section_id DROP NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. create_opname_v2 — sans section
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_opname_v2(
  p_notes text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_count_id     UUID;
  v_count_number TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.opname.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, count_number INTO v_count_id, v_count_number
      FROM inventory_counts WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'count_id',          v_count_id,
        'count_number',      v_count_number,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_count_number := next_count_number();

  INSERT INTO inventory_counts (
    count_number, section_id, status, created_by, notes, idempotency_key
  ) VALUES (
    v_count_number, NULL, 'draft', v_profile, p_notes, p_idempotency_key
  ) RETURNING id INTO v_count_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'opname.create', 'inventory_counts', v_count_id,
    jsonb_build_object(
      'count_number',    v_count_number,
      'idempotency_key', p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'count_id',          v_count_id,
    'count_number',      v_count_number,
    'status',            'draft',
    'idempotent_replay', false
  );
END $function$;

COMMENT ON FUNCTION public.create_opname_v2(text, uuid) IS
  'ADR-027 : opname global (mono-section). MANAGER+ (inventory.opname.create). '
  'Idempotent via p_idempotency_key.';

DROP FUNCTION IF EXISTS public.create_opname_v1(uuid, text, uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. add_opname_item_v2 — attendu depuis products.current_stock
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_opname_item_v2(
  p_count_id uuid, p_product_id uuid,
  p_expected_qty numeric DEFAULT NULL::numeric,
  p_notes text DEFAULT NULL::text)
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
  v_expected := COALESCE(p_expected_qty, v_current_stock, 0);

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
    'expected_qty', v_expected,
    'unit',         COALESCE(v_product_unit, 'pcs')
  );
END $function$;

COMMENT ON FUNCTION public.add_opname_item_v2(uuid, uuid, numeric, text) IS
  'ADR-027 : attendu chargé depuis products.current_stock (stock global). '
  'MANAGER+ (inventory.opname.create).';

DROP FUNCTION IF EXISTS public.add_opname_item_v1(uuid, uuid, numeric, text);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. finalize_opname_v2 — mouvements sans section
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_opname_v2(
  p_count_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
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
  IF NOT has_permission(v_uid, 'inventory.opname.finalize') THEN
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

  IF v_status NOT IN ('counting','review') THEN
    RAISE EXCEPTION 'finalize_not_allowed_in_status';
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
                             'count_id',      p_count_id,
                             'count_number',  v_count_number,
                             'count_item_id', v_item.id,
                             'expected_qty',  v_item.expected_qty,
                             'counted_qty',   v_item.counted_qty
                           ),
      p_lot_id          := NULL
    );

    v_movement_id := (v_movement->>'movement_id')::UUID;
    UPDATE stock_movements
      SET reference_type = 'opname', reference_id = p_count_id
      WHERE id = v_movement_id;

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

COMMENT ON FUNCTION public.finalize_opname_v2(uuid, uuid) IS
  'ADR-027 : finalisation mono-section — opname_in/out sans section, corrige '
  'products.current_stock via la primitive. ADMIN+ (inventory.opname.finalize). '
  'Idempotent : replay sur un comptage finalisé renvoie les mouvements existants.';

DROP FUNCTION IF EXISTS public.finalize_opname_v1(uuid, uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Paires REVOKE S25 (anon hérite EXECUTE via PUBLIC) + GRANT authenticated
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.create_opname_v2(text, uuid)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_opname_item_v2(uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalize_opname_v2(uuid, uuid)                FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_opname_v2(text, uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_opname_item_v2(uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_opname_v2(uuid, uuid)                TO authenticated;
