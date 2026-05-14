-- 20260517000060_init_recipes.sql
-- Session 13 / Phase 2.A — Production + Recipes : init `recipes` table.
--
-- Module 15 (Production & Recipes). Stores the flat BoM (Bill of Materials)
-- for finished products. One product → N recipe rows ; each row points to a
-- raw_material / semi_finished `products.id` with a per-unit quantity.
--
-- Decisions (see docs/workplan/plans/2026-05-13-session-13-phase-2.A-production-recipes.md) :
--   - D-2A-1 : quantity DECIMAL(10,3).
--   - D-2A-11 : standalone RecipeEditor page in Phase 2.A. Fiche-produit inline
--     tab is a follow-up.
--   - UNIQUE PARTIAL on (product_id, material_id) only for active, non-deleted
--     rows — allows multi-version recipe history via soft-delete.
--   - RLS : authenticated SELECT (inventory.read) ; INSERT/UPDATE/DELETE only
--     via SECURITY DEFINER RPCs (upsert_recipe_v1, deactivate_recipe_v1).
--
-- This migration also extends `role_permissions` to grant
-- `inventory.recipes.update` to MANAGER (the perm already exists ; staging
-- audit shows only SUPER_ADMIN + ADMIN are granted). MANAGER+ matches the
-- spec ("manager+ INSERT/UPDATE"). Idempotent via ON CONFLICT.
-- NO has_permission re-CREATE is performed — the CI grep gate stays green.

CREATE TABLE recipes (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID           NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id  UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity     DECIMAL(10,3)  NOT NULL CHECK (quantity > 0),
  unit         TEXT           NOT NULL CHECK (length(trim(unit)) BETWEEN 1 AND 16),
  is_active    BOOLEAN        NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT recipes_product_material_distinct CHECK (product_id <> material_id)
);

-- UNIQUE PARTIAL : one active, non-deleted recipe row per (product, material).
-- Allows soft-deleted history rows to coexist with a fresh active version.
CREATE UNIQUE INDEX recipes_product_material_active_uniq
  ON recipes(product_id, material_id)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_recipes_product
  ON recipes(product_id)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX idx_recipes_material
  ON recipes(material_id)
  WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE TRIGGER recipes_set_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE recipes IS
  'Session 13 — Module 15. Flat BoM (Bill of Materials) for finished products. '
  'One row = one ingredient line. Soft-delete preserves recipe version history. '
  'RLS lockdown — writes via upsert_recipe_v1 / deactivate_recipe_v1 only.';
COMMENT ON COLUMN recipes.quantity IS
  'Quantity of material per 1 unit of finished product. Strictly positive.';
COMMENT ON COLUMN recipes.unit IS
  'Recipe unit (g, kg, mL, L, pcs…). Converted to material.unit via '
  'convert_quantity() at production time. Free-form text 1-16 chars.';

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS : authenticated SELECT (inventory.read), writes via SECURITY DEFINER RPCs.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON recipes FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON recipes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON recipes FROM anon;

-- ──────────────────────────────────────────────────────────────────────────────
-- Grant inventory.recipes.update to MANAGER role.
-- Existing rows (SUPER_ADMIN, ADMIN) preserved via ON CONFLICT DO NOTHING.
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('MANAGER', 'inventory.recipes.update', TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;
