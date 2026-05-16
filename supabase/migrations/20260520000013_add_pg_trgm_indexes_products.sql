-- 20260520000013_add_pg_trgm_indexes_products.sql
-- Session 16 / Phase 2.A — DEV-S15-3.A-02. Trigram GIN indexes on
-- products.name and products.sku to support `similarity()` ranking inside
-- search_ingredients_v1 (migration 014).
--
-- pg_trgm extension already enabled cluster-wide (confirmed in Session 15).
--
-- NOT CONCURRENTLY : MCP apply_migration wraps the body in a transaction.
-- Lock window on V3 dev (< 5k products) is expected < 100ms.

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_sku_trgm
  ON products USING gin (sku gin_trgm_ops)
  WHERE is_active = TRUE AND deleted_at IS NULL;

COMMENT ON INDEX idx_products_name_trgm IS
  'Session 16 / Phase 2.A. Trigram GIN for similarity() ranking on product names.';
COMMENT ON INDEX idx_products_sku_trgm IS
  'Session 16 / Phase 2.A. Trigram GIN for similarity() ranking on SKUs.';
