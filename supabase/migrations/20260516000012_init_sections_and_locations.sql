-- 20260516000012_init_sections_and_locations.sql
-- Session 12 / Phase 1 (complete) / migration 1 :
--   Modèle physique du stock — sections (zones fonctionnelles) + stock_locations
--   (emplacements hiérarchiques sous une section).
--
-- Objectif métier : adapter le système à la réalité spatiale de The Breakery
--   (cf. docs/objectif travail/INVENTORY.md §13).
--   Chaque mouvement de stock pourra référencer une section source/destination
--   (cf. migration suivante 20260516000015 qui ALTER stock_movements).

CREATE TABLE sections (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT         NOT NULL UNIQUE,
  name          TEXT         NOT NULL,
  kind          TEXT         NOT NULL CHECK (kind IN ('warehouse', 'production', 'sales')),
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  display_order INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_sections_active_order
  ON sections(display_order, name)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE TRIGGER sections_set_updated_at
  BEFORE UPDATE ON sections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE sections IS
  'Zones fonctionnelles physiques de la boutique (warehouse, production, sales). '
  'Permet de répondre à "où est mon stock fonctionnellement ?". '
  '5 lignes seedées par défaut : MAIN_WAREHOUSE, PRODUCTION_KITCHEN, PASTRY, CAFE_STORAGE, FRONT_SALES.';
COMMENT ON COLUMN sections.kind IS
  'Catégorie fonctionnelle : warehouse (stockage central) / production (cuisine, atelier) / sales (vitrine, comptoir).';
COMMENT ON COLUMN sections.display_order IS
  'Ordre d''affichage dans les dropdowns / sidebars.';

-- Seed 5 sections par défaut (modifiable via UI /backoffice/inventory/sections)
INSERT INTO sections (code, name, kind, display_order) VALUES
  ('MAIN_WAREHOUSE',     'Main Warehouse',      'warehouse',  10),
  ('PRODUCTION_KITCHEN', 'Production Kitchen',  'production', 20),
  ('PASTRY',             'Pastry Kitchen',      'production', 30),
  ('CAFE_STORAGE',       'Cafe Storage',        'warehouse',  40),
  ('FRONT_SALES',        'Front Sales',         'sales',      50)
ON CONFLICT (code) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- stock_locations : emplacements hiérarchiques optionnels sous une section
--   (ex: rayon A > étagère 3, frigo principal, congélateur). Permet de répondre
--   à "où est physiquement ce sac de farine ?".
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE stock_locations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id          UUID        NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  parent_location_id  UUID        REFERENCES stock_locations(id) ON DELETE RESTRICT,
  code                TEXT        NOT NULL,
  name                TEXT        NOT NULL,
  notes               TEXT,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  UNIQUE (section_id, code)
);

CREATE INDEX idx_stock_locations_section
  ON stock_locations(section_id, name)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE INDEX idx_stock_locations_parent
  ON stock_locations(parent_location_id)
  WHERE parent_location_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER stock_locations_set_updated_at
  BEFORE UPDATE ON stock_locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE stock_locations IS
  'Emplacements hiérarchiques sous une section (rayon, étagère, frigo). '
  'Optionnel — la section seule suffit pour les boutiques simples.';
COMMENT ON COLUMN stock_locations.parent_location_id IS
  'Hiérarchie : NULL = racine de la section. Sinon référence à un autre stock_location.';

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS : sections / stock_locations sont publics en lecture pour tout user
--   authentifié, write réservé à inventory.sections.update (perm seedée
--   dans la migration 17).
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE sections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON sections FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);

CREATE POLICY "perm_write_insert" ON sections FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'inventory.sections.update'));

CREATE POLICY "perm_write_update" ON sections FOR UPDATE
  USING (has_permission(auth.uid(), 'inventory.sections.update'));

CREATE POLICY "auth_read" ON stock_locations FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);

CREATE POLICY "perm_write_insert" ON stock_locations FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'inventory.sections.update'));

CREATE POLICY "perm_write_update" ON stock_locations FOR UPDATE
  USING (has_permission(auth.uid(), 'inventory.sections.update'));
