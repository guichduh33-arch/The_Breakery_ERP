-- 20260505000001_init_modifiers.sql
-- Session 2 / migration 1 : product_modifiers table (M1, M2, M3)
--
-- M1: Stockage modifiers sur l'order = JSONB dans order_items.modifiers
-- M2: Scope modifier groups = Product OR category fallback (XOR)
-- M3: v1 simple — group_required BOOL, single_select uniquement.
--      multi_select reporté à session 5 (combos)

CREATE TYPE modifier_group_type AS ENUM ('single_select', 'multi_select');

CREATE TABLE product_modifiers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID REFERENCES products(id)   ON DELETE CASCADE,
  category_id        UUID REFERENCES categories(id) ON DELETE CASCADE,
  group_name         TEXT NOT NULL,                          -- ex: "Temperature", "Milk"
  group_sort_order   INTEGER NOT NULL DEFAULT 0,
  group_required     BOOLEAN NOT NULL DEFAULT false,         -- si true, le caissier DOIT choisir
  group_type         modifier_group_type NOT NULL DEFAULT 'single_select',
  option_label       TEXT NOT NULL,                          -- ex: "Hot", "Ice", "Oat milk"
  option_icon        TEXT,                                   -- emoji ou nom Lucide (optionnel)
  option_sort_order  INTEGER NOT NULL DEFAULT 0,
  price_adjustment   DECIMAL(12,2) NOT NULL DEFAULT 0,       -- additif sur unit_price
  is_default         BOOLEAN NOT NULL DEFAULT false,         -- pré-coché à l'ouverture du modal
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  -- XOR : un modifier est attaché soit au produit, soit à la catégorie, jamais les deux
  CONSTRAINT product_modifiers_xor_scope CHECK (
    (product_id IS NOT NULL AND category_id IS NULL) OR
    (product_id IS NULL     AND category_id IS NOT NULL)
  ),
  -- Unicité option_label par (scope, group). NULLS NOT DISTINCT pour aligner sur l'XOR.
  UNIQUE NULLS NOT DISTINCT (product_id, category_id, group_name, option_label)
);

CREATE INDEX idx_pmod_product_active  ON product_modifiers(product_id)
  WHERE deleted_at IS NULL AND is_active;
CREATE INDEX idx_pmod_category_active ON product_modifiers(category_id)
  WHERE deleted_at IS NULL AND is_active;

-- RLS : lecture pour tout user authentifié (catalogue lookup côté POS).
-- Pas de policy WRITE en v1 : CRUD via session 7 backoffice (service_role pour seed).
ALTER TABLE product_modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON product_modifiers
  FOR SELECT USING (is_authenticated() AND deleted_at IS NULL AND is_active);

-- Trigger updated_at (helper défini dans 20260503000001_init_auth.sql)
CREATE TRIGGER trg_product_modifiers_updated_at
  BEFORE UPDATE ON product_modifiers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  product_modifiers       IS 'Modifiers produit (Temperature, Milk, Sugar, ...) avec scope XOR product/category';
COMMENT ON COLUMN product_modifiers.product_id  IS 'Scope produit (XOR avec category_id)';
COMMENT ON COLUMN product_modifiers.category_id IS 'Scope catégorie fallback (XOR avec product_id)';
COMMENT ON COLUMN product_modifiers.group_type  IS 'v1 utilise UNIQUEMENT single_select. multi_select prévu session 5 (combos).';
