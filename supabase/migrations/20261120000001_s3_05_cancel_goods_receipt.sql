-- S3-05 — Annuler une réception de bon de commande (GRN).
--
-- Une réception enregistrée par erreur se contre-passe en entier :
--   * stock : un mouvement `purchase_return` inverse par mouvement `purchase`
--     du GRN, via la primitive `record_stock_movement_v2` ; la quantité reçue
--     de la ligne du bon redescend ;
--   * coût moyen : la sortie `purchase_return` ne déclenche pas le calcul du
--     WAC (déclencheur limité à `purchase` / `production_in`) ; la fonction
--     retire donc le lot au prix auquel il est entré, avec l'arrondi du code
--     vivant : W' = round((Q·W − q·c) / (Q − q), 2) ;
--   * comptabilité : l'écriture du GRN (déclencheur `create_purchase_journal_entry`,
--     DR stock / CR fournisseur) est contre-passée à la date du jour, période
--     ouverte exigée, sous `reference_type = 'purchase_return'` ; le stock est
--     crédité sur le compte de réception COURANT, pas sur celui de l'écriture
--     d'origine (régularisation S1-05 1141 → 1142) ;
--   * dette : refus si les paiements du bon dépassent ce qui reste reçu ;
--   * statut du bon : recalculé sur les quantités reçues restantes
--     (received → partial / pending, partial → pending).
--
-- Le mouvement `purchase_return` n'émet aucune écriture par `tr_20_je_emit`
-- (type hors de son périmètre) : la seule écriture comptable est la
-- contre-passation ci-dessous, pas de double comptage.
--
-- Limite assumée (SPECS §10) : la marchandise avariée RENDUE au fournisseur
-- n'a toujours pas de chemin. Cette fonction annule une réception, elle
-- n'enregistre pas un retour fournisseur.

ALTER TABLE public.goods_receipt_notes
  ADD COLUMN cancelled_at           timestamptz,
  ADD COLUMN cancelled_by           uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN cancel_reason          text,
  ADD COLUMN cancel_idempotency_key uuid;

CREATE UNIQUE INDEX goods_receipt_notes_cancel_idempotency_key_key
  ON public.goods_receipt_notes (cancel_idempotency_key)
  WHERE cancel_idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.goods_receipt_notes.cancelled_at IS
  'S3-05 : date d''annulation de la réception (cancel_goods_receipt). NULL = réception active.';
COMMENT ON COLUMN public.goods_receipt_notes.cancelled_by IS
  'S3-05 : profil (user_profiles.id) qui a annulé la réception.';
COMMENT ON COLUMN public.goods_receipt_notes.cancel_reason IS
  'S3-05 : motif obligatoire de l''annulation.';
COMMENT ON COLUMN public.goods_receipt_notes.cancel_idempotency_key IS
  'S3-05 : clé d''idempotence de l''annulation ; le rejeu renvoie metadata->''cancellation''.';

CREATE FUNCTION public.cancel_goods_receipt_v1(
  p_grn_id          uuid,
  p_reason          text,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_profile         uuid;
  v_reason          text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_replay          RECORD;
  v_grn             RECORD;
  v_po              RECORD;
  v_mv              RECORD;
  v_product         RECORD;
  v_po_item         RECORD;
  v_line_qty        numeric;
  v_new_cost        numeric(14,2);
  v_wac_note        text;
  v_mv_key          uuid;
  v_mv_result       jsonb;
  v_lines           jsonb := '[]'::jsonb;
  v_movements_count int := 0;
  v_total_paid      numeric(14,2);
  v_remaining_recv  numeric(14,2);
  v_orig_je         journal_entries%ROWTYPE;
  v_rev_je_id       uuid;
  v_inv_now         uuid;
  v_stock_accounts  uuid[];
  v_total_ordered   numeric;
  v_total_received  numeric;
  v_new_status      text;
  v_result          jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'purchasing.po.cancel') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_grn_id IS NULL THEN
    RAISE EXCEPTION 'grn_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  -- Rejeu rapide : la première réponse est conservée sur le GRN.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, metadata INTO v_replay FROM goods_receipt_notes
      WHERE cancel_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_replay.id <> p_grn_id THEN
        RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE = 'P0001';
      END IF;
      RETURN (v_replay.metadata->'cancellation') || jsonb_build_object('idempotent_replay', true);
    END IF;
  END IF;

  -- Ordre des verrous identique à la réception : bon, puis GRN, lignes, produits.
  SELECT po_id INTO v_grn FROM goods_receipt_notes WHERE id = p_grn_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'grn_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_po FROM purchase_orders
    WHERE id = v_grn.po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_grn FROM goods_receipt_notes WHERE id = p_grn_id FOR UPDATE;

  -- Rejeu concurrent : l'appel gagnant a pu terminer pendant l'attente du verrou.
  IF p_idempotency_key IS NOT NULL AND v_grn.cancel_idempotency_key = p_idempotency_key THEN
    RETURN (v_grn.metadata->'cancellation') || jsonb_build_object('idempotent_replay', true);
  END IF;
  IF v_grn.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'grn_already_cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF v_po.financial_import_document_id IS NOT NULL THEN
    RAISE EXCEPTION 'historical_import_grn_not_cancellable' USING ERRCODE = 'P0003';
  END IF;
  IF v_po.status NOT IN ('partial', 'received') THEN
    RAISE EXCEPTION 'po_invalid_status: %', v_po.status USING ERRCODE = 'P0002';
  END IF;

  -- Dette : après annulation, le fournisseur ne peut pas avoir été payé
  -- au-delà de ce qui reste reçu (sinon le compte fournisseur passerait débiteur).
  -- Un paiement au comptant automatique (GRN `cash`) bloque donc l'annulation.
  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM purchase_payments WHERE purchase_order_id = v_po.id;
  SELECT COALESCE(SUM(total), 0) INTO v_remaining_recv
    FROM goods_receipt_notes
    WHERE po_id = v_po.id AND cancelled_at IS NULL AND id <> p_grn_id;
  IF v_total_paid > v_remaining_recv THEN
    RAISE EXCEPTION 'payments_exceed_remaining_receipts: paid=% remaining_received=%',
      v_total_paid, v_remaining_recv USING ERRCODE = 'P0001';
  END IF;

  -- Verrous des articles par identifiant croissant : deux annulations de bons
  -- différents qui partagent des articles les prennent dans le même ordre.
  PERFORM 1 FROM products
    WHERE id IN (SELECT product_id FROM stock_movements
                  WHERE metadata->>'grn_id' = p_grn_id::text
                    AND movement_type = 'purchase')
    ORDER BY id
    FOR UPDATE;

  FOR v_mv IN
    SELECT * FROM stock_movements
      WHERE metadata->>'grn_id' = p_grn_id::text
        AND movement_type = 'purchase'
      ORDER BY product_id, created_at, id
  LOOP
    SELECT id, current_stock, cost_price, unit INTO v_product
      FROM products WHERE id = v_mv.product_id FOR UPDATE;

    IF v_product.current_stock < v_mv.quantity THEN
      RAISE EXCEPTION 'insufficient_stock_to_reverse: product=% stock=% to_remove=%',
        v_mv.product_id, v_product.current_stock, v_mv.quantity USING ERRCODE = 'P0001';
    END IF;

    -- Coût moyen : retrait pondéré du lot au prix c auquel il est entré.
    -- Sans mouvement intermédiaire, W' retombe sur le WAC d'avant réception
    -- (à l'arrondi à 2 décimales près, celui du déclencheur vivant).
    -- Si l'article a bougé APRÈS la réception (vente, perte, autre entrée…),
    -- hors mouvements de ce même GRN, le retrait pondéré est faux : les unités
    -- sorties entre-temps ont été valorisées au WAC mélangé, et retirer le lot
    -- à c déformerait le coût des unités restantes (10@100 + 10@200 = 150,
    -- vente de 5, retrait de 10 à 200 donnerait 50 au lieu de 100). Le coût
    -- moyen est alors laissé tel quel (`unchanged_intermediate_movements`).
    -- Un mouvement daté du même instant que la réception compte comme
    -- postérieur : en cas d'ex aequo, on choisit de ne pas toucher au coût.
    -- Si le stock restant (Q − q) est nul, le coût moyen n'a plus d'assiette :
    -- il est laissé tel quel ; la prochaine entrée le réensemence (le
    -- déclencheur de réception repart de son coût quand le stock est ≤ 0).
    -- Idem si le mouvement n'avait pas de coût (il n'avait pas touché au WAC)
    -- ou si le calcul ne donnerait pas un coût positif.
    v_new_cost := v_product.cost_price;
    v_wac_note := 'weighted_withdrawal';
    IF v_mv.unit_cost IS NULL OR v_mv.unit_cost <= 0 THEN
      v_wac_note := 'unchanged_no_unit_cost';
    ELSIF EXISTS (
      SELECT 1 FROM stock_movements sm
        WHERE sm.product_id = v_mv.product_id
          AND sm.id <> v_mv.id
          AND sm.created_at >= v_mv.created_at
          AND COALESCE(sm.metadata->>'grn_id', '') <> p_grn_id::text
    ) THEN
      v_wac_note := 'unchanged_intermediate_movements';
    ELSIF v_product.cost_price IS NULL OR v_product.cost_price <= 0 THEN
      v_wac_note := 'unchanged_no_current_cost';
    ELSIF v_product.current_stock - v_mv.quantity <= 0 THEN
      v_wac_note := 'unchanged_zero_remaining_stock';
    ELSE
      v_new_cost := round(
        ((v_product.current_stock * v_product.cost_price) - (v_mv.quantity * v_mv.unit_cost))
          / (v_product.current_stock - v_mv.quantity),
        2);
      IF v_new_cost <= 0 THEN
        v_new_cost := v_product.cost_price;
        v_wac_note := 'unchanged_non_positive_result';
      END IF;
    END IF;

    v_mv_key := CASE
      WHEN p_idempotency_key IS NULL THEN gen_random_uuid()
      ELSE md5(p_idempotency_key::text || ':grn_cancel:' || v_mv.id::text)::uuid
    END;

    -- `supplier_id` reste NULL : la contrainte `chk_supplier_only_on_purchase`
    -- le réserve aux mouvements `purchase` ; il voyage dans les métadonnées.
    v_mv_result := record_stock_movement_v2(
      p_product_id      := v_mv.product_id,
      p_movement_type   := 'purchase_return',
      p_quantity        := -v_mv.quantity,
      p_reason          := 'Receipt cancelled ' || v_grn.grn_number || ': ' || v_reason,
      p_unit_cost       := v_mv.unit_cost,
      p_supplier_id     := NULL,
      p_idempotency_key := v_mv_key,
      p_unit            := v_mv.unit,
      p_from_section_id := NULL,
      p_to_section_id   := NULL,
      p_metadata        := jsonb_build_object(
                            'reference_type',       'purchase_return',
                            'reference_id',         p_grn_id,
                            'grn_id',               p_grn_id,
                            'grn_number',           v_grn.grn_number,
                            'po_id',                v_po.id,
                            'po_number',            v_po.po_number,
                            'po_item_id',           v_mv.metadata->>'po_item_id',
                            'supplier_id',          v_po.supplier_id,
                            'reverses_movement_id', v_mv.id,
                            'cost_price_before',    v_product.cost_price,
                            'cost_price_after',     v_new_cost,
                            'wac_rule',             v_wac_note
                           )
    );
    v_movements_count := v_movements_count + 1;

    IF v_new_cost IS DISTINCT FROM v_product.cost_price THEN
      UPDATE products SET cost_price = v_new_cost, updated_at = now()
        WHERE id = v_mv.product_id;
    END IF;

    -- Quantité reçue de la ligne, dans l'unité du bon (telle que la réception l'a notée).
    v_line_qty := COALESCE((v_mv.metadata->>'po_line_qty')::numeric,
                           v_mv.quantity / NULLIF((v_mv.metadata->>'unit_factor_to_base')::numeric, 0));
    SELECT * INTO v_po_item FROM purchase_order_items
      WHERE id = (v_mv.metadata->>'po_item_id')::uuid AND po_id = v_po.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'po_item_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_line_qty IS NULL OR v_line_qty <= 0 THEN
      RAISE EXCEPTION 'receipt_line_quantity_missing: movement=%', v_mv.id USING ERRCODE = 'P0001';
    END IF;
    IF v_po_item.received_quantity < v_line_qty THEN
      RAISE EXCEPTION 'received_quantity_inconsistent: po_item=% received=% to_remove=%',
        v_po_item.id, v_po_item.received_quantity, v_line_qty USING ERRCODE = 'P0001';
    END IF;
    UPDATE purchase_order_items
      SET received_quantity = received_quantity - v_line_qty,
          updated_at        = now()
      WHERE id = v_po_item.id;

    v_lines := v_lines || jsonb_build_object(
      'product_id',          v_mv.product_id,
      'po_item_id',          v_po_item.id,
      'reversed_movement_id', v_mv.id,
      'movement_id',         v_mv_result->>'movement_id',
      'quantity',            v_mv.quantity,
      'po_line_qty',         v_line_qty,
      'stock_before',        v_product.current_stock,
      'stock_after',         (v_mv_result->>'new_current_stock')::numeric,
      'cost_price_before',   v_product.cost_price,
      'cost_price_after',    v_new_cost,
      'wac_rule',            v_wac_note
    );
  END LOOP;

  -- Contre-passation de l'écriture du GRN (débit ↔ crédit), datée du jour :
  -- la période de la réception peut être close, celle du jour doit être ouverte.
  -- Même schéma que `_reverse_shift_journal_entry_v1`, mais sous le type
  -- canonique `purchase_return` pour ne pas confondre la contre-passation avec
  -- l'écriture de réception (`purchase`).
  SELECT * INTO v_orig_je FROM journal_entries
    WHERE reference_type = 'purchase' AND reference_id = p_grn_id
    ORDER BY created_at LIMIT 1
    FOR UPDATE;
  IF FOUND THEN
    PERFORM check_fiscal_period_open(current_date);
    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by, metadata
    ) VALUES (
      next_journal_entry_number(current_date), current_date,
      'Purchase receipt cancelled ' || v_grn.grn_number,
      'purchase_return', p_grn_id, 'posted',
      v_orig_je.total_credit, v_orig_je.total_debit, v_profile,
      jsonb_build_object('reverses', v_orig_je.id, 'movement_type', 'grn_cancel',
                         'po_id', v_po.id, 'reason', v_reason)
    ) RETURNING id INTO v_rev_je_id;
    -- Les lignes de STOCK ne recopient pas le compte d'origine : la
    -- régularisation S1-05 (`post_stock_chain_catchup_v2`, partie B) a déplacé
    -- en bloc le net des anciennes réceptions du stock général (1141) vers les
    -- matières premières, sans toucher aux écritures d'origine. La valeur d'une
    -- réception vit donc sur le compte où le déclencheur de réception débite
    -- AUJOURD'HUI (`INVENTORY_RAW_MATERIAL`, un seul compte pour tous les
    -- articles) : c'est lui qu'on crédite, pour le montant total des lignes de
    -- stock d'origine. Les autres lignes (dette fournisseur) sont inversées
    -- telles quelles ; l'écriture reste équilibrée.
    v_inv_now := resolve_mapping_account('INVENTORY_RAW_MATERIAL');
    SELECT COALESCE(array_agg(a.id), ARRAY[]::uuid[]) INTO v_stock_accounts
      FROM accounting_mappings am
      JOIN accounts a ON a.code = am.account_code
      WHERE am.mapping_key IN ('INVENTORY_GENERAL', 'INVENTORY_RAW_MATERIAL', 'INVENTORY_FINISHED_GOODS');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    SELECT v_rev_je_id, x.account_id, SUM(x.credit), SUM(x.debit),
           CASE WHEN x.is_stock THEN 'Reversal: inventory received (current stock account)'
                ELSE 'Reversal: ' || COALESCE(MAX(x.description), '') END
      FROM (
        SELECT CASE WHEN l.account_id = ANY (v_stock_accounts) THEN v_inv_now ELSE l.account_id END AS account_id,
               l.account_id = ANY (v_stock_accounts) AS is_stock,
               CASE WHEN l.account_id = ANY (v_stock_accounts) THEN NULL ELSE l.id END AS line_key,
               l.debit, l.credit, l.description
          FROM journal_entry_lines l
          WHERE l.journal_entry_id = v_orig_je.id
      ) x
      GROUP BY x.account_id, x.is_stock, x.line_key;
    UPDATE journal_entries
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reversed_by', v_rev_je_id)
      WHERE id = v_orig_je.id;
  END IF;

  SELECT SUM(quantity), SUM(received_quantity)
    INTO v_total_ordered, v_total_received
    FROM purchase_order_items WHERE po_id = v_po.id;
  v_new_status := CASE
    WHEN COALESCE(v_total_received, 0) <= 0      THEN 'pending'
    WHEN v_total_received >= v_total_ordered     THEN 'received'
    ELSE 'partial'
  END;

  UPDATE purchase_orders
    SET status        = v_new_status,
        received_date = CASE WHEN v_new_status = 'received' THEN received_date ELSE NULL END,
        received_by   = CASE WHEN v_new_status = 'pending' THEN NULL ELSE received_by END,
        updated_at    = now()
    WHERE id = v_po.id;

  v_result := jsonb_build_object(
    'grn_id',            p_grn_id,
    'grn_number',        v_grn.grn_number,
    'po_id',             v_po.id,
    'previous_status',   v_po.status,
    'status',            v_new_status,
    'movements_count',   v_movements_count,
    'reversal_je_id',    v_rev_je_id,
    'reversed_je_id',    v_orig_je.id,
    'cancelled_total',   v_grn.total,
    'idempotent_replay', false
  );

  BEGIN
    UPDATE goods_receipt_notes
      SET cancelled_at           = now(),
          cancelled_by           = v_profile,
          cancel_reason          = v_reason,
          cancel_idempotency_key = p_idempotency_key,
          metadata               = COALESCE(metadata, '{}'::jsonb)
                                   || jsonb_build_object('cancellation', v_result)
      WHERE id = p_grn_id;
  EXCEPTION WHEN unique_violation THEN
    -- Clé déjà consommée par une autre annulation : rien n'est conservé.
    RAISE EXCEPTION 'idempotency_key_conflict' USING ERRCODE = 'P0001';
  END;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (
    v_profile,
    'goods_receipt.cancelled',
    'goods_receipt_notes',
    p_grn_id,
    jsonb_build_object(
      'po_id',           v_po.id,
      'po_number',       v_po.po_number,
      'grn_number',      v_grn.grn_number,
      'reason',          v_reason,
      'reversal_je_id',  v_rev_je_id,
      'idempotency_key', p_idempotency_key,
      'rpc_version',     'v1'
    ),
    jsonb_build_object(
      'po_status',  jsonb_build_object('before', v_po.status, 'after', v_new_status),
      'total_paid', v_total_paid,
      'remaining_received_total', v_remaining_recv,
      'lines',      v_lines
    )
  );

  RETURN v_result;
END $function$;

COMMENT ON FUNCTION public.cancel_goods_receipt_v1(uuid, text, uuid) IS
  'S3-05 : annule une réception de bon de commande (stock, coût moyen, écriture, quantités reçues, statut). Permission purchasing.po.cancel.';

REVOKE ALL ON FUNCTION public.cancel_goods_receipt_v1(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_goods_receipt_v1(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_goods_receipt_v1(uuid, text, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
