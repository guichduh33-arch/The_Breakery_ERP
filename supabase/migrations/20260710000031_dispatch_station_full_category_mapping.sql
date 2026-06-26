-- 20260710000031_dispatch_station_full_category_mapping.sql
-- Spec B-1 Ph1 Bloc 1.2 — mapping métier complet (validé utilisateur).
-- Garde-fou : ne router QUE les catégories finished + show_in_pos.

-- barista
UPDATE categories SET dispatch_station = 'barista'
 WHERE category_type='finished' AND show_in_pos=true
   AND name IN ('Coffee','Speciale Latte','Special Drinks');

-- kitchen (préparés/chauffés à la commande)
UPDATE categories SET dispatch_station = 'kitchen'
 WHERE category_type='finished' AND show_in_pos=true
   AND name IN ('Panini','Simple Plate','Plate','Savoury','Sandwiches',
                'Savoury Croissant','Bagel','Classic Sandwiches','Sandwiches Baguette');

-- display (vitrine : pré-faits / embouteillés)
UPDATE categories SET dispatch_station = 'display'
 WHERE category_type='finished' AND show_in_pos=true
   AND name IN ('Bread','Pastry','Viennoiserie','Buns','Cake','Classic Breads',
                'Classic Viennoiserie','Individual Pastries','Others Viennoiserie',
                'Sourdough Breads','Savouries','Other drinks','HASIL BOHEMI');

-- Filet de sécurité : aucune catégorie non vendue ne doit rester routée.
UPDATE categories SET dispatch_station = 'none'
 WHERE (show_in_pos=false OR category_type <> 'finished')
   AND dispatch_station <> 'none';
