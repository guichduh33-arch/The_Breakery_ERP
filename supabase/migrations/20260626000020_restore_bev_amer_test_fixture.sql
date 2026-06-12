-- 20260626000020_restore_bev_amer_test_fixture.sql
-- Corrective de _018 : BEV-AMER n'était PAS un résidu de test jetable — c'est
-- l'Americano du seed canonique (supabase/seed.sql, composant de COMBO-001),
-- fixture de ~20 fichiers Vitest live + 2 suites pgTAP
-- (products_cost_price_guard, update_product_v1) qui le résolvent par SKU.
-- Son NOM avait été écrasé en 'test_smoke' par un test — le soft-delete de
-- _018 cassait update_cost_price_v1 (product_not_found) en cascade.
-- Restore : undelete + vrai nom. L'homonymie avec BEV-001 'Americano'
-- (l'autre vague de seed, 2026-05-14, porteuse des commandes) est assumée —
-- les pickers affichent le SKU depuis le fix m3.
-- Les 4 autres SKUs mnémoniques soft-deleted (_018/_019 : BEV-CAPP, BEV-FLAT,
-- PAS-PAIN, BRD-SOUR) ne sont référencés par AUCUN test (grep vérifié) et
-- restent supprimés.

UPDATE products
   SET name = 'Americano', is_active = true, deleted_at = NULL
 WHERE sku = 'BEV-AMER';
