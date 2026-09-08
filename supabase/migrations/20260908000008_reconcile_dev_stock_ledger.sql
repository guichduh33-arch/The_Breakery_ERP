-- 20260908000008_reconcile_dev_stock_ledger.sql
--
-- Finding F5 de docs/audits/2026-08-31-audit-stock-management.md (P1, dimension A).
-- Dernier des cinq P1 du lot stock. Ce n'est PAS un correctif de code.
--
-- ═══ Le constat ═══
--
-- Le contrôle canonique de précision — `current_stock − SUM(stock_movements.quantity) = 0`
-- — échouait sur **16 des 50 produits** ayant des mouvements (relevé du 2026-09-08 ;
-- l'audit en comptait 15 le 2026-08-31, un s'est ajouté depuis). Somme des écarts
-- valorisée au coût : **≈ 41,5 M IDR**.
--
-- La cause n'est pas un défaut de RPC : le mécanisme d'écriture est correct (la
-- primitive fait INSERT puis UPDATE dans la même transaction, sous FOR UPDATE). C'est
-- que le ledger dev a été **purgé** vers le 2026-08-11 alors que `audit_logs` a été
-- conservé — 1 202 audits de mouvement pointent vers un `stock_movements.id` qui
-- n'existe plus — et que les specs vitest live-RPC remettent `current_stock` à plat
-- sans écrire de mouvement.
--
-- Conséquence : le contrôle de précision de la dimension A était **aveugle**, et le
-- serait resté. C'est la consigne m10 (« toute mise en production entre son stock
-- initial PAR le ledger ») prise à revers.
--
-- ═══ Le geste ═══
--
-- Pour chaque produit en écart, on écrit UN mouvement qui vaut solde d'ouverture, de
-- sorte que le ledger et `current_stock` se rejoignent.
--
-- **`current_stock` ne change pas.** La valeur affichée aujourd'hui est celle que
-- l'exploitation considère juste ; c'est le ledger qui manque de lignes. On ramène donc
-- d'abord `current_stock` à la somme du ledger, puis le mouvement l'y ramène à sa
-- valeur d'origine. Net sur `products` : zéro. Net sur `stock_movements` : une ligne
-- qui explique enfin l'écart.
--
-- ARBITRAGE DE MAMAT (2026-09-08) sur le TYPE de mouvement. Sa consigne initiale disait
-- « mouvements d'ajustement » ; le relevé a montré qu'`adjustment_in` / `adjustment_out`
-- déclenchent tous deux le trigger d'écriture comptable `tr_20_je_emit`, soit **seize**
-- écritures pour ~41,5 M IDR sur la compta de dev (période de septembre ouverte : elles
-- passeraient sans erreur, et fausseraient les rapports). Arbitrage retenu, mixte :
--
--   · les **12 écarts positifs** (il manque une ENTRÉE au ledger) partent en
--     `movement_type = 'incoming'` — c'est le type prévu pour un stock initial hors flux
--     d'achat, le trigger JE l'ignore explicitement, et il ne touche pas au WAC ;
--   · les **4 écarts négatifs** (il manque une SORTIE) partent en `'adjustment_out'` —
--     toute sortie honnête émet une écriture, on l'assume. Les quatre concernés sont des
--     produits de test ou soft-deleted (`Test Baguette`, `Vitest PO Product A/B`,
--     `Americano` supprimé).
--
-- Soit **4 écritures comptables au lieu de 16**. Un `incoming` négatif aurait évité les
-- quatre, mais aurait menti dans le vocabulaire du ledger : refusé.
--
-- ═══ Idempotence ═══
--
-- Par construction : la boucle ne traite que les produits dont l'écart est non nul.
-- Après passage, l'écart vaut zéro et un rejeu ne fait rien. Pas de clé d'idempotence à
-- gérer.
--
-- ═══ Portée ═══
--
-- Ce fichier ne vise QUE la base dev V3 (`ikcyvlovptebroadgtvd`). Il n'a pas de sens sur
-- une base neuve, où il ne trouvera aucun écart et sortira sans rien écrire — c'est
-- voulu, et c'est ce qui le rend inoffensif dans la lignée de migrations.

-- Dépendance explicite : la primitive doit savoir lire la référence dans p_metadata
-- (F2, migration 20260908000005). Sans elle, le marqueur de ce lot serait silencieusement
-- remplacé par 'admin_action' et les lignes deviendraient indistinguables d'un
-- ajustement manuel. On échoue plutôt que d'écrire une trace muette.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'record_stock_movement_v1'
       AND pg_get_functiondef(p.oid) ~ 'v_meta->>''reference_type'''
  ) THEN
    RAISE EXCEPTION 'record_stock_movement_v1 ne lit pas encore la référence dans p_metadata — appliquer 20260908000005 (F2) d''abord';
  END IF;
END $$;

DO $$
DECLARE
  v_ligne       RECORD;
  v_type        movement_type;
  v_traites     INT := 0;
  v_entrees     INT := 0;
  v_sorties     INT := 0;
BEGIN
  FOR v_ligne IN
    SELECT p.id, p.sku, p.name, p.unit,
           p.current_stock,
           agg.ledger,
           (p.current_stock - agg.ledger) AS ecart
      FROM products p
      JOIN (SELECT sm.product_id, SUM(sm.quantity) AS ledger
              FROM stock_movements sm GROUP BY sm.product_id) agg
        ON agg.product_id = p.id
     WHERE abs(p.current_stock - agg.ledger) > 0.001
     ORDER BY p.sku
  LOOP
    -- Écart positif : il manque une ENTRÉE au ledger -> 'incoming' (aucune écriture
    -- comptable, aucun effet WAC). Écart négatif : il manque une SORTIE ->
    -- 'adjustment_out', qui émet son écriture.
    IF v_ligne.ecart > 0 THEN
      v_type   := 'incoming'::movement_type;
      v_entrees := v_entrees + 1;
    ELSE
      v_type   := 'adjustment_out'::movement_type;
      v_sorties := v_sorties + 1;
    END IF;

    -- On aligne d'abord products sur le ledger ; le mouvement le ramènera à sa valeur
    -- d'origine. `current_stock` est donc inchangé de bout en bout.
    UPDATE products
       SET current_stock = current_stock - v_ligne.ecart
     WHERE id = v_ligne.id;

    PERFORM record_stock_movement_v1(
      p_product_id      := v_ligne.id,
      p_movement_type   := v_type,
      p_quantity        := v_ligne.ecart,
      p_reason          := 'Recalage ledger dev 2026-09-08 (F5) — solde d''ouverture, '
                           || 'ledger purge du 2026-08-11 + specs live-RPC',
      p_unit            := v_ligne.unit,
      p_metadata        := jsonb_build_object(
                             'reference_type',      'stock_reconciliation_20260908',
                             'finding',             'F5',
                             'ecart',               v_ligne.ecart,
                             'ledger_avant',        v_ligne.ledger,
                             'current_stock_cible', v_ligne.current_stock
                           )
    );

    v_traites := v_traites + 1;
  END LOOP;

  RAISE NOTICE 'F5 — % produits recalés (% entrées incoming, % sorties adjustment_out)',
    v_traites, v_entrees, v_sorties;
END $$;

-- Contrôle de sortie : le geste n'a de valeur que s'il rend le contrôle de précision
-- exact. On refuse la migration s'il reste un seul écart, plutôt que de laisser croire
-- que la dimension A est désormais mesurable.
DO $$
DECLARE v_restants INT;
BEGIN
  SELECT count(*) INTO v_restants
    FROM products p
    JOIN (SELECT sm.product_id, SUM(sm.quantity) AS ledger
            FROM stock_movements sm GROUP BY sm.product_id) agg ON agg.product_id = p.id
   WHERE abs(p.current_stock - agg.ledger) > 0.001;

  IF v_restants <> 0 THEN
    RAISE EXCEPTION 'recalage incomplet : % produits restent en écart', v_restants;
  END IF;
END $$;
