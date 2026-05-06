-- 20260509000001_init_customer_categories.sql
-- Session 7 / migration 1 : customer pricing tiers

CREATE TYPE price_modifier_type AS ENUM ('retail', 'wholesale', 'discount_percentage', 'custom');

CREATE TABLE customer_categories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL,
  color               TEXT,
  icon                TEXT,
  price_modifier_type price_modifier_type NOT NULL DEFAULT 'retail',
  discount_percentage DECIMAL(5,2) NOT NULL DEFAULT 0
                      CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  loyalty_enabled     BOOLEAN NOT NULL DEFAULT true,
  points_multiplier   DECIMAL(4,2) NOT NULL DEFAULT 1.0
                      CHECK (points_multiplier >= 0),
  is_default          BOOLEAN NOT NULL DEFAULT false,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (slug)
);

CREATE UNIQUE INDEX idx_customer_categories_one_default
  ON customer_categories(is_default)
  WHERE is_default = true AND deleted_at IS NULL;

CREATE INDEX idx_customer_categories_active
  ON customer_categories(slug)
  WHERE deleted_at IS NULL AND is_active;

CREATE TRIGGER customer_categories_set_updated_at
  BEFORE UPDATE ON customer_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE customer_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON customer_categories FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);
