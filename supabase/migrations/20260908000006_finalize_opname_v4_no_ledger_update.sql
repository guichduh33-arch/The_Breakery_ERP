-- 20260908000006_finalize_opname_v4_no_ledger_update.sql
--
-- Volet 2 du finding F2 (docs/audits/2026-08-31-audit-stock-management.md, P1).
-- Le volet 1 (`20260908000005`) a donné à la primitive de quoi poser la référence à
-- l'insertion ; ce fichier retire le geste interdit.
--
-- ═══ Ce qui disparaît ═══
--
-- `finalize_opname_v3` faisait, après chaque appel à la primitive :
--
--     UPDATE stock_movements
--        SET reference_type = 'opname', reference_id = p_count_id
--      WHERE id = v_movement_id;
--
-- C'était la SEULE écriture UPDATE du schéma sur le ledger append-only (balayage
-- exhaustif de `pg_proc` le 2026-08-31, refait le 2026-09-08 : une seule fonction, zéro
-- DELETE). Elle aboutissait parce que la RPC est SECURITY DEFINER — la RLS ne
-- verrouille que `authenticated`, jamais le propriétaire.
--
-- La v4 passe la même référence en métadonnée ; la primitive la pose à l'INSERT. Le
-- résultat en base est identique — `reference_type='opname'`, `reference_id` = l'id du
-- comptage — mais il n'y a plus de seconde écriture.
--
-- Gain qui n'est pas cosmétique : l'invariant « aucune fonction ne réécrit le ledger »
-- devient VÉRIFIABLE MÉCANIQUEMENT. Le test pgTAP de ce lot l'asserte sur tout le
-- schéma (`pg_proc` ~ 'UPDATE stock_movements' → zéro), là où il ne tenait jusqu'ici
-- que par la discipline de relecture.
--
-- ═══ Ce qui NE change pas ═══
--
-- Signature identique, statuts et erreurs identiques (`count_not_found`,
-- `finalize_not_allowed_in_status`, `missing_counts`), rejeu idempotent identique — il
-- relit les mouvements par `reference_type='opname' AND reference_id = p_count_id`, ce
-- que la v4 continue d'écrire. Les 11 mouvements d'opname déjà en base restent lisibles
-- à l'identique : c'est la même paire de valeurs, seule la façon de l'écrire change.
--
-- `inventory_count_items.movement_id` reste renseigné par la v4 (UPDATE sur la table de
-- comptage, pas sur le ledger — celle-là n'est pas append-only).
--
-- Versioning monotone : _v4 créée, _v3 droppée dans ce fichier, signature inchangée.
-- Contrairement à la primitive du volet 1, `finalize_opname` est un contrat PUBLIÉ
-- (grant `authenticated`, appelée par le back-office) : elle se bumpe.
-- PROVENANCE DU CORPS : pg_get_functiondef sur la base live, relevé le 2026-09-08.
-- Grants : miroir des grants live (authenticated + service_role) + REVOKE PUBLIC/anon.
-- Types à régénérer (packages/supabase/src/types.generated.ts).

CREATE OR REPLACE FUNCTION public.finalize_opname_v4(
  p_count_id uuid,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
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
      -- v4 (F2) : la référence part AVEC le mouvement. La primitive la pose à
      -- l'insertion — plus d'UPDATE d'estampillage sur un ledger append-only.
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

    -- `inventory_count_items` n'est PAS un ledger append-only : cet UPDATE reste.
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

REVOKE EXECUTE ON FUNCTION public.finalize_opname_v4(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_opname_v4(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.finalize_opname_v4(uuid, uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.finalize_opname_v4(uuid, uuid) IS
  'Finalise un comptage d''inventaire. v4 (F2, 2026-09-08) : la référence du mouvement '
  'part en métadonnée et la primitive la pose À L''INSERTION — l''UPDATE d''estampillage '
  'sur stock_movements a disparu. C''était la seule écriture UPDATE du schéma sur le '
  'ledger append-only. Ne jamais la réintroduire : l''invariant est désormais asserté '
  'par test sur pg_proc.';

DROP FUNCTION IF EXISTS public.finalize_opname_v3(uuid, uuid);
