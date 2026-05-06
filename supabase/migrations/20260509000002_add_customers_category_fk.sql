-- 20260509000002_add_customers_category_fk.sql
-- Session 7 / migration 2 : attach customer pricing tier

ALTER TABLE customers
  ADD COLUMN category_id UUID REFERENCES customer_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_customers_category ON customers(category_id) WHERE deleted_at IS NULL;
