-- 20260503000002_init_catalog.sql
-- Phase 2 / migration 3 : catalog produits

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX idx_categories_active_sort ON categories(is_active, sort_order) WHERE deleted_at IS NULL;

CREATE TABLE products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku             TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  category_id     UUID NOT NULL REFERENCES categories(id),
  retail_price    DECIMAL(12,2) NOT NULL CHECK (retail_price >= 0),
  tax_inclusive   BOOLEAN NOT NULL DEFAULT true,
  image_url       TEXT,
  current_stock   DECIMAL(10,3) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_favorite     BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_products_category ON products(category_id, is_active) WHERE deleted_at IS NULL;
CREATE INDEX idx_products_favorite ON products(is_favorite) WHERE is_favorite = true AND deleted_at IS NULL;

CREATE TRIGGER categories_set_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE categories IS 'Catégories produits (Beverage, Bread, Pastry, ...)';
COMMENT ON TABLE products   IS 'Catalogue produits avec stock cache';
