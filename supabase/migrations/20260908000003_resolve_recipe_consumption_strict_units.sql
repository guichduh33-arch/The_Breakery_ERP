-- 20260908000003_resolve_recipe_consumption_strict_units.sql
--
-- Finding F1 de docs/audits/2026-08-31-audit-stock-management.md (P1, dimension A,
-- chemin de l'argent). Le défaut le plus lourd de cet audit.
--
-- ═══ Le défaut ═══
--
-- `_resolve_recipe_consumption_v1` convertit l'unité de la ligne de recette vers
-- l'unité de stock du produit avec le wrapper TOLÉRANT `_try_convert_quantity`, dont
-- le corps se termine par :
--
--     EXCEPTION WHEN OTHERS THEN RETURN p_qty;   -- « falls back to raw qty »
--
-- Quand la paire d'unités n'est pas convertible, il rend donc la quantité BRUTE.
-- Mesuré sur dev le 2026-08-31 puis re-mesuré le 2026-09-08 :
--   · `SELECT public._try_convert_quantity(200,'ml','ltr')` → 200 au lieu de 0,2 ;
--   · le résolveur rendait 10 `cup` de Syrup Hazelnut (1 808 704 IDR) là où la
--     recette demande 10 g, et 5 `pcs` de Pizza Slice là où elle demande 5 g.
--
-- C'est la classe d'erreur ×1000 que le projet combat, et elle s'écrit dans un ledger
-- APPEND-ONLY : la ligne fausse ne se corrige jamais, elle se contre-passe.
--
-- Asymétrie qui achève de nommer le bug : la PRODUCTION appelle le `convert_quantity`
-- STRICT et refuse la même ligne de recette (`record_production_v5`,
-- `record_batch_production_v7`). Même ligne, deux verdicts : la production dit non, la
-- vente déduit un nombre faux, en silence.
--
-- Origine de la dérive, assumée à l'écrit dans `20260710000022` : le wrapper tolérant
-- avait été conçu pour une fonction d'AFFICHAGE de coût (`recipe_bom_full`), où une
-- paire inconvertible dégrade une estimation. Il a ensuite été réutilisé tel quel sur
-- le chemin qui ÉCRIT le ledger.
--
-- ═══ Le geste ═══
--
-- Le résolveur appelle désormais `convert_quantity` STRICT et échoue franchement
-- (`unit_conversion_missing`, ERRCODE P0002) plutôt que de sous- ou sur-consommer.
-- Même doctrine que l'ADR-008 D5 (`recipe_depth_exceeded`) : on ne consomme jamais un
-- nombre approximatif en silence.
--
-- L'échec NOMME la matière et la paire d'unités. `convert_quantity` seul dirait
-- « g -> cup » sans dire de quel ingrédient il parle ; sur une commande de dix lignes,
-- c'est inexploitable au comptoir. D'où la boucle : une conversion par matière, et un
-- message qui porte le nom du produit.
--
-- ═══ Pourquoi un CREATE OR REPLACE et non un `_v2` ═══
--
-- `_resolve_recipe_consumption_v1` est un helper INTERNE : ses grants live sont
-- `{postgres=X, service_role=X}` (relevé le 2026-09-08), aucun `authenticated`, et
-- aucun appel depuis l'app ni depuis une Edge Function. Il n'a jamais été un contrat
-- publié. Le versionnage monotone protège les contrats publiés ; le dépôt applique
-- déjà cette distinction à `_record_sale_stock_v1`, remplacé EN PLACE deux fois — dont
-- `20260710000107`, qui changeait son contrat d'erreur (P0002) sans bumper un seul
-- appelant.
--
-- La conséquence est énorme et vaut d'être écrite : le bump aurait entraîné la
-- fermeture transitive de NEUF RPC, dont les sept du chemin de l'argent
-- (`complete_order_with_payment`, `pay_existing_order`, `create_b2b_order`,
-- `cancel_b2b_order`, `refund_order_rpc`, `void_order_rpc`,
-- `_record_order_item_waste`) et deux au second niveau (`cancel_order_item_rpc`,
-- `update_order_item_qty`). Aucune de leurs signatures ne change ici, aucun appelant
-- applicatif n'est touché.
--
-- ═══ Exposition au moment de la bascule ═══
--
-- Relevé du 2026-09-08 sur dev : DEUX lignes de recette actives portent une paire
-- inconvertible — `Syrup Hazelnut` (g → cup) et `Pizza Slice` (g → pcs) —, toutes deux
-- sur le même parent `Almond cream`. L'audit le décrivait comme `is_active = false` ;
-- il est en réalité SOFT-DELETED (`deleted_at IS NOT NULL`), donc encore plus hors
-- d'atteinte. **Zéro produit vendable touché aujourd'hui.** La bascule ne peut pas
-- casser une vente en cours ; elle ferme la porte avant que de telles lignes
-- n'apparaissent sur un produit vivant.
--
-- `recipes.unit` et `products.unit` sont tous deux NOT NULL (vérifié le 2026-09-08) :
-- la tolérance au NULL de `_try_convert_quantity` ne protégeait aucun cas réel.
--
-- ═══ Ce qui NE change pas ═══
--
-- `_try_convert_quantity` reste en place et reste appelé par les deux fonctions
-- d'AFFICHAGE pour lesquelles il a été écrit — `recipe_bom_full_v2` et
-- `recipe_direct_cost_v1`. Son commentaire dit désormais que le chemin d'écriture lui
-- est interdit.
--
-- Limite observée, NON traitée ici (hors périmètre F1, à arbitrer séparément) : quand
-- une même matière est atteinte à plusieurs profondeurs avec des unités DIFFÉRENTES,
-- l'agrégat garde `MIN(line_unit)` et convertit tout depuis cette unité-là. Le
-- comportement est inchangé par cette migration ; il est seulement désormais strict
-- sur la convertibilité de l'unité retenue.

CREATE OR REPLACE FUNCTION public._resolve_recipe_consumption_v1(
  p_product_id uuid,
  p_qty numeric,
  p_max_depth integer DEFAULT 5
)
RETURNS TABLE(product_id uuid, qty_base numeric, unit text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ligne  RECORD;
  v_converti NUMERIC;
BEGIN
  FOR v_ligne IN
    WITH RECURSIVE walk AS (
      SELECT r.material_id,
             (p_qty * r.quantity::NUMERIC) AS qty,
             r.unit AS line_unit,
             1 AS depth,
             ARRAY[r.product_id, r.material_id]::UUID[] AS path
        FROM recipes r
       WHERE r.product_id = p_product_id
         AND r.is_active = TRUE
         AND r.deleted_at IS NULL
      UNION ALL
      SELECT cr.material_id,
             (w.qty * cr.quantity::NUMERIC),
             cr.unit,
             w.depth + 1,
             w.path || cr.material_id
        FROM walk w
        JOIN products wp ON wp.id = w.material_id
        JOIN recipes  cr ON cr.product_id = w.material_id
                         AND cr.is_active = TRUE
                         AND cr.deleted_at IS NULL
       WHERE wp.track_inventory = FALSE
         AND w.depth < p_max_depth
         AND NOT (cr.material_id = ANY(w.path))
    )
    SELECT w.material_id     AS materiau_id,
           SUM(w.qty)        AS qty_ligne,
           MIN(w.line_unit)  AS unite_ligne,
           p.unit            AS unite_stock,
           p.name            AS materiau_nom
      FROM walk w
      JOIN products p ON p.id = w.material_id
     WHERE p.track_inventory = TRUE
     GROUP BY w.material_id, p.unit, p.name
  LOOP
    -- Strict (F1) : une paire inconvertible échoue, elle ne se rabat plus sur la
    -- quantité brute. Le message nomme la matière — `convert_quantity` seul ne dirait
    -- que « g -> cup », inexploitable sur une commande de dix lignes.
    BEGIN
      v_converti := public.convert_quantity(v_ligne.qty_ligne, v_ligne.unite_ligne, v_ligne.unite_stock);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'unit_conversion_missing: % (% -> %)',
        v_ligne.materiau_nom, v_ligne.unite_ligne, v_ligne.unite_stock
        USING ERRCODE = 'P0002';
    END;

    IF v_converti > 0 THEN
      product_id := v_ligne.materiau_id;
      qty_base   := v_converti;
      unit       := v_ligne.unite_stock;
      RETURN NEXT;
    END IF;
  END LOOP;
END $function$;

-- Grants : miroir exact des grants live relevés le 2026-09-08
-- (`{postgres=X, service_role=X}`). `authenticated` n'y figure pas et ne doit pas y
-- figurer — c'est un helper interne appelé depuis des RPC SECURITY DEFINER.
REVOKE EXECUTE ON FUNCTION public._resolve_recipe_consumption_v1(uuid, numeric, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_recipe_consumption_v1(uuid, numeric, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public._resolve_recipe_consumption_v1(uuid, numeric, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public._resolve_recipe_consumption_v1(uuid, numeric, integer) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._resolve_recipe_consumption_v1(uuid, numeric, integer) IS
  'Résout la consommation de recette pour une vente. Depuis F1 (2026-09-08), convertit '
  'par convert_quantity STRICT et lève unit_conversion_missing (P0002) en nommant la '
  'matière : une paire inconvertible ne se rabat plus sur la quantité brute — c''était '
  'la classe d''erreur x1000, écrite dans un ledger append-only. Ne JAMAIS rebrancher '
  'ce chemin sur _try_convert_quantity, réservé à l''affichage.';

COMMENT ON FUNCTION public._try_convert_quantity(numeric, text, text) IS
  'Conversion TOLÉRANTE : rend la quantité brute quand la paire d''unités n''est pas '
  'convertible. Réservée aux fonctions d''AFFICHAGE de coût (recipe_bom_full_v2, '
  'recipe_direct_cost_v1), où une paire inconvertible dégrade une estimation. '
  'INTERDITE sur tout chemin qui écrit stock_movements — voir F1 (2026-09-08) et le '
  'commentaire de _resolve_recipe_consumption_v1.';
