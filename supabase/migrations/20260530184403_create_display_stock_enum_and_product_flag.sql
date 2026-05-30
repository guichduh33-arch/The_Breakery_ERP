-- 20260530184403_create_display_stock_enum_and_product_flag.sql
-- POS display-stock isolation — Wave 1.
-- ENUM des types de mouvement vitrine + drapeau produit "exposé en vitrine".
-- (Migration appliquée sur le cloud V3 dev ; ce fichier rapatrie l'écart cloud↔git.)

CREATE TYPE display_movement_type AS ENUM (
  'stock_in',           -- mise en vitrine
  'sale',               -- vente (pont depuis complete_order v10)
  'return_to_kitchen',  -- clôture : retour cuisine
  'waste',              -- perte réelle
  'adjustment'          -- correction de comptage
);

ALTER TABLE products
  ADD COLUMN is_display_item BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN products.is_display_item IS
  'true = produit fini exposé en vitrine POS. La vente garde sur display_stock '
  '(pas current_stock) ; la mise en vitrine ne touche pas current_stock.';
