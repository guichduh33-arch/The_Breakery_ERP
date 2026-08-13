-- =============================================================================
-- À RELIRE PAR MAMAT AVANT EXÉCUTION — NE PAS LANCER TEL QUEL.
-- =============================================================================
--
-- Candidats de purge des données de TEST repérées pendant l'audit UX/UI du
-- 2026-08-13 (lot 8), projet Supabase cloud V3 dev `ikcyvlovptebroadgtvd`.
--
-- Ce fichier n'a JAMAIS été exécuté. Toutes les instructions destructives sont
-- COMMENTÉES (préfixe `--`). Il est écrit pour être relu, pas piped :
--   1. Chaque bloc commence par un SELECT de PRÉVISUALISATION (non destructif)
--      qui rejoue exactement le filtre du DELETE proposé, avec le compte attendu.
--   2. Le DELETE correspondant est en-dessous, commenté. Décommenter UNIQUEMENT
--      après avoir vérifié que le SELECT ne remonte QUE des lignes de test.
--   3. Envelopper toute exécution dans BEGIN; ... ROLLBACK; d'abord, inspecter,
--      puis COMMIT seulement si le compte matche.
--
-- ⚠️ Dépendances : products et orders sont référencés par des tables enfant
--    (order_items, stock_movements, b2b_*, combos, recipes…). Un DELETE brut
--    échouera sur les FK ou cascadera. Le nettoyage réel doit passer par les
--    RPC métier (soft-delete / void) ou traiter les enfants d'abord — ce n'est
--    PAS une décision d'agent. Les DELETE ci-dessous sont des CANDIDATS à
--    arbitrer, pas une procédure prête.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A. PRODUITS DE TEST — compte attendu : 7
--    5 fixtures live-spec ([TEST] … / ZZ-TEST-*) + 2 SKU *-TEST
--    (COMBO-NESTED-TEST « Nested Test Combo », FINISHED-TRIGGER-TEST
--     « Trigger Test Finished »).
-- -----------------------------------------------------------------------------

-- Prévisualisation (SÛR) :
SELECT id, sku, name, is_active, deleted_at
FROM products
WHERE name ILIKE '%[TEST]%'
   OR sku  ILIKE 'ZZ-TEST%'
   OR sku  ILIKE 'ZZ-%TEST%'
   OR sku  ILIKE '%TEST%'
ORDER BY name;

-- Candidat destructif (à arbitrer — voir avertissement FK ci-dessus) :
-- DELETE FROM products
-- WHERE name ILIKE '%[TEST]%'
--    OR sku  ILIKE 'ZZ-TEST%'
--    OR sku  ILIKE 'ZZ-%TEST%'
--    OR sku  ILIKE '%TEST%';
-- -- attendu : 7 lignes. Si <> 7, NE PAS committer : le catalogue a bougé.
--
-- Variante non destructive (préférable) — soft-delete + retrait du POS :
-- UPDATE products
-- SET deleted_at = now(), is_active = false
-- WHERE (name ILIKE '%[TEST]%'
--        OR sku ILIKE 'ZZ-TEST%'
--        OR sku ILIKE 'ZZ-%TEST%'
--        OR sku ILIKE '%TEST%')
--   AND deleted_at IS NULL;
-- -- attendu : 7 lignes.


-- -----------------------------------------------------------------------------
-- B. COMMANDES DE TEST — compte attendu : 16
--    order_number `#TEST-<epoch>[-<suffixe>]`, toutes dine_in, paid/completed,
--    générées les 2026-08-11 et 2026-08-12 (seed de spec).
-- -----------------------------------------------------------------------------

-- Prévisualisation (SÛR) :
SELECT id, order_number, status, order_type, created_at
FROM orders
WHERE order_number ILIKE '%TEST%'
ORDER BY created_at DESC;

-- Candidat destructif — les commandes ont des enfants (order_items, paiements,
-- stock_movements, JE comptables). NE PAS DELETE brut : cela casserait le
-- ledger append-only stock_movements et les écritures. Traiter par void métier
-- ou purge orchestrée. Bloc laissé COMMENTÉ à dessein :
-- DELETE FROM orders WHERE order_number ILIKE '%TEST%';   -- ⚠️ cassera les FK
-- -- attendu : 16 lignes (mais NE PAS exécuter sans plan enfants).


-- -----------------------------------------------------------------------------
-- C. CATÉGORIES — reliquats de test E2E
--    « S41E2E Cat » ×3, DÉJÀ soft-deleted (is_active=false, deleted_at set).
--    compte attendu : 3.
--    (Le reste des catégories inactives — Bread, Pastry, Ingredients (merged)…
--     sont des fusions/archives MÉTIER, PAS du test : ne PAS les toucher.)
-- -----------------------------------------------------------------------------

-- Prévisualisation (SÛR) :
SELECT id, name, is_active, deleted_at, sort_order
FROM categories
WHERE name ILIKE 'S41E2E%'
ORDER BY sort_order;

-- Candidat de purge dure des 3 reliquats E2E (déjà soft-deleted) :
-- DELETE FROM categories WHERE name ILIKE 'S41E2E%';
-- -- attendu : 3 lignes. Vérifier d'abord qu'aucun produit ne les référence :
-- --   SELECT count(*) FROM products p
-- --   JOIN categories c ON c.id = p.category_id
-- --   WHERE c.name ILIKE 'S41E2E%';   -- doit valoir 0 avant tout DELETE.


-- -----------------------------------------------------------------------------
-- D. TAXONOMIE CATÉGORIES — PAS une purge, un signalement pour Mamat.
--    Incohérences de casse / langue relevées sur les catégories ACTIVES
--    (aucune action automatique — arbitrage humain requis) :
--      · casse mélangée : « BEVERAGE » vs « Other drinks », « meat » (minuscule),
--        blocs ALL-CAPS (DAIRY, FLOUR, SAUCE, SEED, VEGETABLE…) vs Title Case.
--      · faute de frappe : « KITCHEN SUPLLIES » → « KITCHEN SUPPLIES ».
--      · langues mêlées : « HASIL BOHEMI » (id), « Speciale Latte » (it),
--        « Viennoiserie » / « Savoury Croissant » (fr/en).
--    Exemple de normalisation de casse (À VALIDER nom par nom, ne pas passer en
--    masse — certains ALL-CAPS sont peut-être voulus comme familles d'ingrédients) :
-- -- UPDATE categories SET name = 'Kitchen Supplies'
-- --   WHERE name = 'KITCHEN SUPLLIES';   -- corrige la faute + la casse.
-- =============================================================================
