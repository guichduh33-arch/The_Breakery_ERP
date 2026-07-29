-- ADR-008 D7 — annulation d'une production : refus si le lot a bougé, et retour
-- au helper standard. Corps repris du corps LIVE de revert_production_v1
-- (pg_get_functiondef, V3 dev, 2026-07-29), jamais du fichier de migration.
--
-- D7 correction 1 — `already_consumed`.
--   Avant : produire 10, en vendre 4, annuler dans les 24 h retirait 10 d'un
--   stock qui n'en contenait plus que 6. Le stock passait à -4 et la
--   comptabilité suivait.
--   Après : toute SORTIE du produit fini postérieure à l'entrée en stock du lot
--   fait échouer l'annulation (`already_consumed`, P0001). Une ENTRÉE ultérieure
--   — une deuxième fournée du même produit — ne bloque pas : elle ne rend pas la
--   contre-passation fausse. C'est la lecture retenue de « le lot a bougé »,
--   l'ADR employant une formule qui, prise au pied de la lettre, aurait bloqué
--   sur une simple réapprovision.
--   Le refus NOMME le chemin de correction : un ajustement de stock. Refuser
--   sans dire quoi faire enfermerait le gestionnaire dans une impasse — l'ADR
--   laissait le choix entre « un inventaire ou un ajustement », c'est
--   l'ajustement qui est retenu (geste ponctuel, déjà outillé par `adjust_stock`
--   et déjà porteur de son écriture comptable).
--
--   La date de référence est le `created_at` du mouvement `production_in`, PAS
--   `production_records.production_date` : cette dernière est antidatable (le
--   lot la patche), et comparer les ventes à une date antidatée ferait remonter
--   des sorties antérieures à l'entrée réelle du stock.
--
--   La borne est `>=`, pas `>`, et c'est délibéré. `now()` est figé sur la
--   transaction : dans une production PAR LOT, un semi-fini produit puis
--   consommé par une autre ligne du même lot porte exactement le même
--   `created_at` que son entrée. Avec une borne stricte, cette consommation
--   passerait inaperçue et l'annulation retirerait du stock déjà parti. La borne
--   inclusive refuse alors par excès — un refus se rattrape par un ajustement,
--   une contre-passation fausse ne se rattrape pas.
--
-- D7 correction 2 — retour au primitive.
--   Les contre-passations passent désormais par `record_stock_movement_v1` au
--   lieu d'un `INSERT INTO stock_movements` direct suivi d'`UPDATE products` et
--   d'`UPDATE section_stock` à la main. Le helper tient lui-même le stock
--   produit, le stock de section et la ligne d'audit `stock.movement` : les
--   mises à jour manuelles DOIVENT disparaître, sinon le stock serait décrémenté
--   deux fois. Effet de bord assumé : le helper impose
--   `reference_type = 'admin_action'` et n'accepte pas de `reference_id` — le
--   rattachement à la production survit par `metadata->>'production_id'`, seule
--   clé que la boucle de contre-passation utilise déjà.
--
--   `p_allow_negative := TRUE` sur ces contre-passations : on restaure un état
--   antérieur connu. La garde `already_consumed` garantit qu'aucune sortie n'a
--   eu lieu ; le seul cas où le stock repasse sous zéro est celui où il y était
--   DÉJÀ avant la production, et refuser reviendrait alors à figer l'erreur.
--
--   Le drapeau `reverse_of_production` est conservé et les contre-écritures
--   restent émises ici : `tr_stock_movement_je` ne sait pas contre-passer — sur
--   un `production_in` il poste `ABS(quantity)` toujours dans le même sens. Lui
--   laisser la main produirait une écriture fausse, pas une contre-écriture.
--
--   Les contre-écritures passent maintenant sous `check_fiscal_period_open` :
--   annuler une production ne peut plus écrire dans une période close.
--
-- D8 — statu quo acté par l'ADR : la permission `inventory.production.delete`
-- suffit, pas de PIN. Rien à coder, la garde est déjà en place.

CREATE OR REPLACE FUNCTION public.revert_production_v2(p_production_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_pr            RECORD;
  v_orig_mv       RECORD;
  v_orig_je       RECORD;
  v_je_line       RECORD;
  v_new_je_id     UUID;
  v_entry_no      TEXT;
  v_mv_count      INT := 0;
  v_je_count      INT := 0;
  v_orig_lot_id   UUID;
  v_in_created_at TIMESTAMPTZ;
  v_blockers      JSONB := '[]'::JSONB;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.delete') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT * INTO v_pr FROM production_records WHERE id = p_production_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_pr.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_reverted' USING ERRCODE='P0001';
  END IF;

  IF v_pr.production_date < now() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'production_too_old' USING ERRCODE='P0001';
  END IF;

  -- ADR-008 D7 — le lot a-t-il bougé ? Référence : l'entrée en stock réelle.
  SELECT sm.created_at INTO v_in_created_at
    FROM stock_movements sm
   WHERE sm.metadata->>'production_id' = p_production_id::text
     AND sm.movement_type = 'production_in'
     AND COALESCE(sm.metadata->>'reverse_of_production','false') = 'false'
   ORDER BY sm.created_at
   LIMIT 1;

  IF v_in_created_at IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'movement_id',   x.id,
               'movement_type', x.movement_type,
               'quantity',      x.quantity,
               'occurred_at',   x.created_at,
               'reason',        x.reason
             ) ORDER BY x.created_at), '[]'::JSONB)
      INTO v_blockers
      FROM stock_movements x
     WHERE x.product_id = v_pr.product_id
       AND x.quantity < 0
       AND x.created_at >= v_in_created_at
       AND COALESCE(x.metadata->>'production_id','') <> p_production_id::text;

    IF jsonb_array_length(v_blockers) > 0 THEN
      RAISE EXCEPTION 'already_consumed' USING ERRCODE='P0001',
        DETAIL = v_blockers::text,
        HINT = 'The produced stock has already left inventory. Correct it with a stock adjustment (adjust_stock) instead of reverting the production.';
    END IF;
  END IF;

  -- Contre-passation des mouvements, par le helper standard : il tient
  -- products.current_stock, section_stock et la ligne d'audit.
  FOR v_orig_mv IN
    SELECT sm.*
      FROM stock_movements sm
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND COALESCE(sm.metadata->>'reverse_of_production','false') = 'false'
        AND sm.movement_type IN ('production_in','production_out')
      ORDER BY sm.created_at
  LOOP
    PERFORM record_stock_movement_v1(
      p_product_id      := v_orig_mv.product_id,
      p_movement_type   := v_orig_mv.movement_type,
      p_quantity        := -v_orig_mv.quantity,
      p_reason          := 'Reversal of ' || v_orig_mv.reason,
      p_unit_cost       := v_orig_mv.unit_cost,
      p_supplier_id     := v_orig_mv.supplier_id,
      p_idempotency_key := NULL,
      p_unit            := v_orig_mv.unit,
      p_from_section_id := v_orig_mv.to_section_id,
      p_to_section_id   := v_orig_mv.from_section_id,
      p_metadata        := jsonb_build_object(
                            'reverse_of_production',  true,
                            'original_movement_id',   v_orig_mv.id,
                            'production_id',          p_production_id,
                            'production_number',      v_pr.production_number,
                            'reason',                 p_reason
                           ),
      p_lot_id          := NULL,
      p_allow_negative  := TRUE
    );
    v_mv_count := v_mv_count + 1;
  END LOOP;

  -- Contre-écritures. Ramassées par le mouvement d'origine, ce qui inclut la
  -- charge de raté d'ADR-008 D2 (rattachée au production_in).
  FOR v_orig_je IN
    SELECT je.id AS je_id, je.entry_date, je.total_debit, je.total_credit, je.reference_id, je.metadata
      FROM journal_entries je
      JOIN stock_movements sm ON sm.id = je.reference_id
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND je.reference_type = 'stock_movement'
        AND COALESCE(je.metadata->>'reverse_of_production','false') = 'false'
  LOOP
    -- ADR-008 D7 : une annulation n'écrit plus dans une période close.
    PERFORM check_fiscal_period_open(now()::date);
    v_entry_no := next_journal_entry_number(now()::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by, metadata
    ) VALUES (
      v_entry_no,
      now()::date,
      'Reversal of production ' || v_pr.production_number,
      'production',
      p_production_id,
      'posted',
      v_orig_je.total_debit,
      v_orig_je.total_credit,
      v_profile,
      jsonb_build_object(
        'reverse_of_production', true,
        'original_je_id',        v_orig_je.je_id,
        'production_id',         p_production_id,
        'production_number',     v_pr.production_number,
        'reason',                p_reason,
        'movement_type',         'reversal:' || (v_orig_je.metadata->>'movement_type') || ':' || v_orig_je.je_id::text
      )
    ) RETURNING id INTO v_new_je_id;

    FOR v_je_line IN
      SELECT account_id, debit, credit, description
        FROM journal_entry_lines
        WHERE journal_entry_id = v_orig_je.je_id
    LOOP
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (
          v_new_je_id,
          v_je_line.account_id,
          v_je_line.credit,
          v_je_line.debit,
          'Reversal: ' || v_je_line.description
        );
    END LOOP;

    v_je_count := v_je_count + 1;
  END LOOP;

  SELECT lot_id INTO v_orig_lot_id
    FROM stock_movements
    WHERE metadata->>'production_id' = p_production_id::text
      AND movement_type = 'production_in'
      AND COALESCE(metadata->>'reverse_of_production','false') = 'false'
      AND lot_id IS NOT NULL
    LIMIT 1;

  IF v_orig_lot_id IS NOT NULL THEN
    UPDATE stock_lots
      SET quantity = 0, status = 'consumed', updated_at = now()
      WHERE id = v_orig_lot_id;
  END IF;

  UPDATE production_records
    SET reverted_at        = now(),
        reverted_by        = v_profile,
        reverted_reason    = p_reason,
        materials_consumed = FALSE,
        stock_updated      = FALSE,
        je_posted          = FALSE,
        updated_at         = now()
    WHERE id = p_production_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'production.revert', 'production_records', p_production_id,
    jsonb_build_object(
      'reason',                  p_reason,
      'reverse_movements_count', v_mv_count,
      'reverse_je_count',        v_je_count,
      'voided_lot_id',           v_orig_lot_id
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'production_id',           p_production_id,
    'reverse_movements_count', v_mv_count,
    'reverse_je_count',        v_je_count,
    'voided_lot_id',           v_orig_lot_id
  );
END $function$;

COMMENT ON FUNCTION public.revert_production_v2(uuid, text) IS
  'ADR-008 D7/D8. Annule une production dans les 24 h : refusée si le stock produit est sorti (already_consumed, orienter vers un ajustement), contre-passations par record_stock_movement_v1, contre-écritures sous garde de période fiscale.';

DROP FUNCTION IF EXISTS public.revert_production_v1(uuid, text);

REVOKE EXECUTE ON FUNCTION public.revert_production_v2(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revert_production_v2(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.revert_production_v2(uuid, text) TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
