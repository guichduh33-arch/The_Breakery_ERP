-- 20260818000013_finalize_opname_v3_review_only.sql
--
-- LE DÉFAUT. `finalize_opname_v2` accepte `counting` autant que `review`. Le
-- palier de révélation — `validate_opname_v1`, qui fige la saisie et découvre
-- les écarts ligne par ligne — devient donc facultatif : on peut poster
-- l'écriture comptable définitive d'un inventaire sans avoir jamais vu les
-- écarts qu'on valide. L'écran offrait le même raccourci, et il le portait sur
-- l'aplat encre, c'est-à-dire sur le poids visuel maximal de la page.
--
-- Ce n'est pas le comptage à l'aveugle qui est en cause : l'attendu reste masqué
-- pendant la saisie dans les deux chemins. C'est la REVUE qui disparaît.
-- L'inventaire est le seul endroit du back-office où un geste d'écran devient
-- une écriture comptable irréversible sur un ledger append-only ; le double
-- palier est la seule chose qui s'interpose.
--
-- LE CHANGEMENT. Une seule ligne du corps :
--   IF v_status NOT IN ('counting','review')  ->  IF v_status <> 'review'
-- Le code d'erreur et son message ne bougent pas (`finalize_not_allowed_in_status`),
-- pour que les appelants existants continuent de le reconnaître. Le reste du
-- corps est repris tel quel de `pg_get_functiondef(finalize_opname_v2)` relevé
-- sur la base live, jamais du fichier de migration d'origine.
--
-- CE QUI RESTE VRAI. Le rejeu idempotent (`v_status = 'finalized'`) est traité
-- AVANT la garde de statut : un second appel après finalisation rend toujours le
-- résultat de la première exécution, il ne tombe pas dans la nouvelle exception.
--
-- APPELANTS. Un seul : `useOpnameMutations.ts` (back-office). Aucune Edge
-- Function, aucun appel POS. Il est pointé sur `_v3` dans le même commit.

CREATE OR REPLACE FUNCTION public.finalize_opname_v3(p_count_id uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
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

  -- v3 — la révélation n'est plus facultative. `counting` doit passer par
  -- `validate_opname_v1`, qui fige la saisie et découvre les écarts.
  IF v_status <> 'review' THEN
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

-- Versioning monotone : la version remplacée disparaît dans la même migration.
DROP FUNCTION IF EXISTS public.finalize_opname_v2(uuid, uuid);

-- Defense-in-depth : `anon` hérite EXECUTE via PUBLIC, un REVOKE sur anon seul
-- ne suffirait pas.
REVOKE EXECUTE ON FUNCTION public.finalize_opname_v3(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finalize_opname_v3(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.finalize_opname_v3(uuid, uuid) IS
  'Finalise un inventaire DEPUIS `review` UNIQUEMENT : émet un stock_movement '
  'par ligne à écart non nul et laisse le trigger comptable poster le JE. v3 '
  'retire `counting` de la garde de statut — la révélation par '
  'validate_opname_v1 n''est plus contournable. Rejeu idempotent inchangé : un '
  'appel sur un compte déjà finalisé rend le résultat de la première exécution.';
