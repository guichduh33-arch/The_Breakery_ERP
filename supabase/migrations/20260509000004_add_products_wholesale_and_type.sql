-- 20260509000004_add_products_wholesale_and_type.sql
-- Session 7 / migration 4 : extend products for combos + wholesale pricing

ALTER TABLE products
  ADD COLUMN wholesale_price DECIMAL(12,2) CHECK (wholesale_price IS NULL OR wholesale_price >= 0),
  ADD COLUMN product_type    TEXT NOT NULL DEFAULT 'finished'
                             CHECK (product_type IN ('finished', 'combo'));

CREATE INDEX idx_products_combo
  ON products(id)
  WHERE product_type = 'combo' AND deleted_at IS NULL;
