-- 20260710000030_dispatch_station_bakery_to_display.sql
-- Spec B-1 Ph1 Bloc 1.1 — le dispatch de vente cesse d'emprunter le nom de
-- production 'bakery' : la station de récupération à la vente est 'display'
-- (vitrine). Axe production (sections) NON touché.
--
-- ORDRE OBLIGATOIRE (chicken-and-egg du CHECK) :
--   1. DROP l'ancien CHECK (qui n'autorise pas encore 'display').
--   2. UPDATE bakery -> display (sinon viole l'ancien CHECK si avant DROP,
--      ou le nouveau si après ADD avec des lignes 'bakery' présentes).
--   3. ADD le nouveau CHECK (les lignes sont déjà toutes valides).

-- 1. Retirer l'ancienne contrainte.
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_dispatch_station_check;

-- 2. Migrer les données (idempotent : no-op si déjà 'display').
UPDATE categories  SET dispatch_station = 'display' WHERE dispatch_station = 'bakery';
UPDATE order_items SET dispatch_station = 'display' WHERE dispatch_station = 'bakery';

-- 3. Ajouter la nouvelle contrainte.
ALTER TABLE categories
  ADD CONSTRAINT categories_dispatch_station_check
  CHECK (dispatch_station IN ('kitchen', 'barista', 'display', 'none'));

-- 4. Mettre à jour les commentaires (citaient encore 'bakery').
COMMENT ON COLUMN categories.dispatch_station IS
  'Station de dispatch de VENTE : kitchen | barista | display | none. Copié sur order_items.dispatch_station au send-to-kitchen. Distinct de la station de PRODUCTION (sections).';
COMMENT ON COLUMN order_items.dispatch_station IS
  'Copié de categories.dispatch_station au INSERT du RPC. Valeurs : kitchen | barista | display | none.';
