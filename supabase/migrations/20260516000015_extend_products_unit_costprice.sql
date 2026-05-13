-- 20260516000015_extend_products_unit_costprice.sql
-- Session 12 / Phase 1 (complete) / migration 4 :
--   ALTER products : ajouter unit (NOT NULL DEFAULT 'pcs') + cost_price (DECIMAL).
--
-- Pourquoi maintenant : la migration suivante (16) ALTER stock_movements ADD unit
--   en NOT NULL et veut backfill depuis products.unit. Cost_price est requis pour :
--     - récupération automatique du coût de production (COGS — module Production
--       Phase 4 du plan)
--     - alimentation des JE Inventory (waste, adjustment) en valeur monétaire
--   sans avoir à interroger un PO ou un mouvement antérieur.
--
-- Décision unit default 'pcs' : la plupart des produits The Breakery se vendent
--   à la pièce (croissant, baguette). Les matières premières (farine, levure, etc.)
--   doivent être passées en kg/L via UPDATE manuel après cette migration.
--
-- cost_price reste à 0 par défaut : un produit sans cost_price ne génère pas de
--   JE valorisé (le trigger JE skip ou émet 0 — cf. Phase 8). À renseigner via
--   le BO ou via la première réception PO (qui set cost_price = unit_cost).

ALTER TABLE products
  ADD COLUMN unit       TEXT          NOT NULL DEFAULT 'pcs',
  ADD COLUMN cost_price DECIMAL(14,2) NOT NULL DEFAULT 0
    CHECK (cost_price >= 0);

-- Pas de CHECK explicite sur unit (référentiel libre — peut être 'pcs', 'kg',
-- 'g', 'L', 'mL', 'box', 'unit', etc.). La cohérence avec unit_conversions est
-- vérifiée à l'usage par le helper convert_quantity().

COMMENT ON COLUMN products.unit IS
  'Unité de mesure du stock (pcs, kg, g, L, mL, box, ...). Default ''pcs''. '
  'Doit exister dans unit_conversions pour les conversions recipe / réception.';
COMMENT ON COLUMN products.cost_price IS
  'Coût unitaire moyen (last-cost method MVP). Mis à jour automatiquement par '
  'receive_purchase_order_v1 (module Purchasing complete) lorsque unit_cost est '
  'fourni. Utilisé par le trigger Inventory JE pour valoriser waste/adjustment/opname.';
