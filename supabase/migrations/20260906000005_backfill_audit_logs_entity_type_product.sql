-- Audit lot 1, P1 sécurité n°4 — reprise des lignes historiques.
--
-- Quatre RPC écrivaient `entity_type = 'products'` (PLURIEL) là où le reste du
-- schéma et l'onglet History d'un produit utilisent 'product' (SINGULIER). Les
-- RPC sont corrigées par 20260906000002 et 20260906000003 ; cette migration
-- réaligne les lignes déjà écrites, sans quoi le drill-down resterait aveugle
-- sur tout l'historique.
--
-- Arbitrage Mamat du 2026-09-06 : une seule valeur canonique en base, plutôt
-- qu'un filtre `IN ('product','products')` porté par chaque écran à venir.
--
-- `audit_logs` est append-only POUR LE CODE APPLICATIF (la RLS révoque UPDATE à
-- `authenticated`). Cette correction ponctuelle tourne en postgres dans une
-- migration : c'est le seul véhicule autorisé, et elle ne touche ni `actor_id`,
-- ni `action`, ni `payload`, ni `metadata` — seul le libellé du type d'entité
-- change. Le geste n'est pas rejouable : après lui, plus aucune ligne 'products'.
--
-- Relevé sur dev le 2026-09-06, avant application :
--   product.cost_recomputed        234  (entity_id → un produit réel)
--   product.costs_recomputed_bulk   85  (entity_id NULL, jamais affichable)
--   combo.upserted                    4  (entity_id → un produit réel)
--   combo.deleted                     0

UPDATE audit_logs
   SET entity_type = 'product'
 WHERE entity_type = 'products'
   AND action IN (
     'product.cost_recomputed',
     'product.costs_recomputed_bulk',
     'combo.upserted',
     'combo.deleted'
   );
