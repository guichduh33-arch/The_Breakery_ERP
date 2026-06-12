-- 20260626000018_data_cleanup_test_residue.sql
-- Audit 2026-06-12 m4 — dev-DB cleanup (validé owner le 12/06) :
-- usage vérifié avant action (order_items + stock_movements par SKU).
-- Soft only — jamais de hard delete (FK order_items).

-- 1. Merge catégorie dupliquée 'Ingredients' → 'Ingredient'
--    (1 seul produit dedans : S41E2E Ingredient, déjà soft-deleted).
UPDATE products SET category_id = (SELECT id FROM categories WHERE name = 'Ingredient' AND is_active)
 WHERE category_id = (SELECT id FROM categories WHERE name = 'Ingredients');
UPDATE categories SET is_active = false, name = 'Ingredients (merged)'
 WHERE name = 'Ingredients';

-- 2. Résidus de test :
--    test_smoke (BEV-AMER) est un DOUBLON d'Americano (BEV-001 existe, actif,
--    utilisé) écrasé par un test — 0 movement / 0 order_item → soft-delete.
UPDATE products SET is_active = false, deleted_at = now()
 WHERE name = 'test_smoke' AND sku = 'BEV-AMER' AND deleted_at IS NULL;
--    Catégorie S41E2E Cat encore active (ses produits sont déjà soft-deleted).
UPDATE categories SET is_active = false WHERE name = 'S41E2E Cat' AND is_active;

-- 3. Homonymes (décision owner) :
--    BEV-CAPP 'Flat White' → 'Cappuccino' (intention évidente du SKU, 0 usage).
UPDATE products SET name = 'Cappuccino' WHERE sku = 'BEV-CAPP' AND name = 'Flat White';
--    Doublons même nom + même catégorie, 0 usage, alors que l'original est
--    utilisé en commande : BEV-FLAT (dup de BEV-002 'Flat White') et
--    PAS-PAIN (dup de PAS-001 'Pain au Chocolat') → soft-delete.
UPDATE products SET is_active = false, deleted_at = now()
 WHERE sku IN ('BEV-FLAT', 'PAS-PAIN') AND deleted_at IS NULL;
--    Paires inter-catégories (American Bagel, Cheesy Brie en Bagel ET
--    Sandwiches) laissées telles quelles — produits plausiblement distincts ;
--    les pickers affichent désormais le SKU (fix m3).
