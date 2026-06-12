-- 20260626000019_cleanup_remaining_seed_duplicates.sql
-- Corrective de _018 : le rename BEV-CAPP → 'Cappuccino' (exemple du plan)
-- a créé un homonyme — BEV-004 'Cappuccino' existe déjà et est UTILISÉ
-- (2 order_items). BEV-CAPP est en réalité un doublon du batch de seed
-- mnémonique (BEV-CAPP/BEV-FLAT/PAS-PAIN/BRD-SOUR/SND-*) dont AUCUN SKU ne
-- porte d'usage, alors que la série numérotée (BEV-002/BEV-004/PAS-001/
-- BRD-001/BAG-001) porte les commandes → soft-delete, pas rename.
-- BRD-SOUR (dup de BRD-001 'Sourdough Loaf', 0 usage des deux côtés) suit la
-- même règle. Les paires inter-catégories SND-AMER/SND-CHEE restent en place
-- (produits Sandwiches plausiblement distincts des Bagels).

UPDATE products SET is_active = false, deleted_at = now()
 WHERE sku IN ('BEV-CAPP', 'BRD-SOUR') AND deleted_at IS NULL;
