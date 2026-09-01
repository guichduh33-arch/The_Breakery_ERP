-- Recalage des donnees laissees par le bug corrige dans les migrations
-- 20260901000002 / 20260901000003 (et, en amont, par la 20260825000010).
--
-- Le fait, releve le 2026-09-01 : 17 mouvements `sale` portent sur un produit
-- NON SUIVI en stock (`track_inventory = false`), reparti sur 9 commandes,
-- TOUTES payees par `pay_existing_order` en v16 (`audit_logs.metadata->>
-- 'rpc_version' = 'v16-adr013-lot4'`) — donc avant la v18 qui a introduit la
-- consommation de recette. Consequence double, a chaque fois :
--   * le produit FINI s'est vu retirer du stock qu'il n'aurait pas du perdre
--     (d'ou 9 produits a `current_stock` negatif, jusqu'a -4) ;
--   * les INGREDIENTS de sa recette n'ont jamais ete consommes.
--
-- Ce que fait cette migration, pour chacun de ces 17 mouvements :
--   1. rend au produit fini la quantite retiree a tort ;
--   2. consomme la recette qui aurait du l'etre, resolue par
--      `_resolve_recipe_consumption_v1` (meme helper que le money-path).
--
-- `stock_movements` est un ledger APPEND-ONLY : rien n'est efface ni modifie.
-- On AJOUTE des mouvements `adjustment` portant un `reference_type` dedie
-- (`stock_correction_20260901`) pour qu'ils restent reconnaissables, et un
-- `reason` qui cite le mouvement d'origine. `reference_id` garde l'id de la
-- commande fautive, pour pouvoir remonter la chaine.
--
-- HYPOTHESE ASSUMEE, arbitrage Mamat du 2026-09-01. Les fiches produit ont ete
-- modifiees APRES certaines de ces ventes (American Bagel le 2026-08-25 21:03,
-- Capuccino et Americano le 2026-08-25 23:13) : ni les drapeaux ni la recette
-- du jour de la vente ne sont connus. On applique donc la recette ACTUELLE.
-- Si une recette a change depuis, la quantite consommee ici est approchee.
-- Deux produits (`Long Black`, `Fresh Juice Strawberry`) n'ont AUCUNE recette
-- active : ils recoivent le geste 1 et rien d'autre — il n'y a rien a consommer.
--
-- ATTENDU, et ce n'est PAS un effet de bord de ce recalage : 23 ingredients
-- terminent a un stock negatif. Ils y etaient deja, ou a zero, avant — la base
-- ne porte pas les receptions correspondantes. Le recalage rend la dette
-- visible, il ne la cree pas.
--
-- Rejouable sans dommage : la garde du debut sort si des lignes de correction
-- existent deja.

DO $recalage$
DECLARE
  v_actor    UUID;
  v_mov      RECORD;
  v_cons     RECORD;
  v_credits  INT := 0;
  v_debits   INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM stock_movements WHERE reference_type = 'stock_correction_20260901') THEN
    RAISE NOTICE 'Recalage 2026-09-01 deja applique — rien a faire.';
    RETURN;
  END IF;

  -- Acteur : le profil proprietaire. `stock_movements.created_by` attend un
  -- `user_profiles.id`, jamais un `auth.uid()`.
  SELECT id INTO v_actor FROM user_profiles
   WHERE id = '00000000-0000-0000-0000-000000000001' AND deleted_at IS NULL;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Recalage 2026-09-01 : profil acteur introuvable';
  END IF;

  FOR v_mov IN
    SELECT sm.id, sm.product_id, ABS(sm.quantity) AS qty, sm.unit,
           sm.reference_id AS order_id, p.name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
     WHERE sm.movement_type  = 'sale'
       AND sm.reference_type = 'orders'
       AND COALESCE(p.track_inventory, true) = false
     ORDER BY sm.created_at
  LOOP
    -- 1) Rendre au produit fini ce qui lui a ete retire a tort.
    INSERT INTO stock_movements
      (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by, reason)
    VALUES
      (v_mov.product_id, 'adjustment', v_mov.qty, v_mov.unit,
       'stock_correction_20260901', v_mov.order_id, v_actor,
       'Recalage 2026-09-01 : la vente avait deduit le produit fini au lieu de sa recette (mouvement ' || v_mov.id || ')');
    UPDATE products
       SET current_stock = current_stock + v_mov.qty, updated_at = now()
     WHERE id = v_mov.product_id;
    v_credits := v_credits + 1;

    -- 2) Consommer la recette qui aurait du l'etre.
    FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_mov.product_id, v_mov.qty) LOOP
      INSERT INTO stock_movements
        (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by, reason)
      VALUES
        (v_cons.product_id, 'adjustment', -v_cons.qty_base, COALESCE(v_cons.unit, 'pcs'),
         'stock_correction_20260901', v_mov.order_id, v_actor,
         'Recalage 2026-09-01 : ingredient jamais consomme a la vente de ' || v_mov.name || ' (mouvement ' || v_mov.id || ')');
      UPDATE products
         SET current_stock = current_stock - v_cons.qty_base, updated_at = now()
       WHERE id = v_cons.product_id;
      v_debits := v_debits + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Recalage 2026-09-01 : % restitutions de produit fini, % consommations d''ingredient.',
    v_credits, v_debits;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'stock.correction', 'stock_movements', NULL, jsonb_build_object(
    'correction',        'stock_correction_20260901',
    'cause',             'pay_existing_order v16 deduisait le produit fini au lieu de sa recette',
    'finished_credits',  v_credits,
    'ingredient_debits', v_debits,
    'recipe_source',     'recette active au 2026-09-01 (celle du jour de vente est inconnue)'));
END $recalage$;
