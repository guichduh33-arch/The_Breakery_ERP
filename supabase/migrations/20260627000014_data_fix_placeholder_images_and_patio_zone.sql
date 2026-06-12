-- 20260627000014_data_fix_placeholder_images_and_patio_zone.sql
-- S43 Wave E (P2-8, P2-9) — data only, aucun schéma.
-- (NB : prévu `_012` au plan ; décalé en `_014` par les 2 correctives Wave C.)
-- (a) via.placeholder.com timeout en boucle au POS (console + latence) ;
--     NULL déclenche le fallback BrandMark de ProductCard. 8 lignes au moment
--     de l'apply.
UPDATE products SET image_url = NULL WHERE image_url LIKE '%via.placeholder.com%';
-- (b) Convention FloorPlanModal : sort_order >= 100 = Terrace. Les tables
--     Patio-* du seed étaient < 100 (6 et 7) → affichées en Interior, zone
--     Terrace vide.
UPDATE restaurant_tables SET sort_order = 100 + sort_order
  WHERE name ILIKE 'patio%' AND sort_order < 100;
