-- 20260516000005_add_products_min_stock.sql
-- Session 12 / migration 5 : add min_stock_threshold to products.
-- Drives low-stock UI badge in backoffice. 0 = disabled.

ALTER TABLE products
  ADD COLUMN min_stock_threshold DECIMAL(10,3) NOT NULL DEFAULT 0
    CHECK (min_stock_threshold >= 0);

COMMENT ON COLUMN products.min_stock_threshold IS
  'Low-stock UI badge trigger. 0 = disabled (no badge).';
