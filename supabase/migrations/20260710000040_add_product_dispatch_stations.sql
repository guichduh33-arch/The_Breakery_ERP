-- 20260710000040_add_product_dispatch_stations.sql
-- Spec B-1 Ph2 Bloc 2.1 — routage multi-station au niveau produit.

ALTER TABLE products
  ADD COLUMN dispatch_stations text[] NULL;

ALTER TABLE order_items
  ADD COLUMN dispatch_stations text[] NULL;

-- Chaque élément doit être une station de prep valide (jamais 'none' : l'absence
-- de routage = tableau NULL/vide). NULL passe le CHECK (override non posé).
ALTER TABLE products
  ADD CONSTRAINT products_dispatch_stations_check
  CHECK (dispatch_stations IS NULL OR dispatch_stations <@ ARRAY['kitchen','barista','display']::text[]);

COMMENT ON COLUMN products.dispatch_stations IS
  'Override produit du routage de vente (multi-station). NULL = hériter [categories.dispatch_station]. Spec B-1 Ph2.';
COMMENT ON COLUMN order_items.dispatch_stations IS
  'Snapshot des stations résolues à la vente (multi). order_items.dispatch_station (single) = 1er élément, legacy. Spec B-1 Ph2.';

-- Index KDS sur le tableau (lecture par station).
CREATE INDEX idx_oi_dispatch_stations_gin ON order_items USING GIN (dispatch_stations);
