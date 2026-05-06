-- 20260509000003_init_product_category_prices.sql
-- Session 7 / migration 3 : custom per-category overrides for individual products

CREATE TABLE product_category_prices (
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_category_id UUID NOT NULL REFERENCES customer_categories(id) ON DELETE CASCADE,
  price                DECIMAL(12,2) NOT NULL CHECK (price >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, customer_category_id)
);

CREATE TRIGGER product_category_prices_set_updated_at
  BEFORE UPDATE ON product_category_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE product_category_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON product_category_prices FOR SELECT
  USING (is_authenticated());
