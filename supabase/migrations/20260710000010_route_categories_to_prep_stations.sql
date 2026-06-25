-- 20260710000010_route_categories_to_prep_stations.sql
-- Spec A (POS held-order lifecycle), Bloc 1 — minimal, NON-ambiguous routing so
-- the Send-to-Kitchen flow becomes active & testable. Data-only, idempotent,
-- reversible. Targets stable category names. Full mapping (cold/hot sandwiches,
-- juices, viennoiserie) is deferred to Spec B.
--
-- DOWN (manual revert): UPDATE categories SET dispatch_station = 'none'
--   WHERE name IN ('Coffee','Speciale Latte','Special Drinks',
--                  'Simple Plate','Panini','Savoury Croissant');

UPDATE public.categories
   SET dispatch_station = 'barista'
 WHERE name IN ('Coffee', 'Speciale Latte', 'Special Drinks')
   AND dispatch_station IS DISTINCT FROM 'barista';

UPDATE public.categories
   SET dispatch_station = 'kitchen'
 WHERE name IN ('Simple Plate', 'Panini', 'Savoury Croissant')
   AND dispatch_station IS DISTINCT FROM 'kitchen';
