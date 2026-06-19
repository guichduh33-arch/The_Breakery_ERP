-- 20260702000012_combo_schema.sql
-- Session 47 / Wave A — configurable-combo schema (choice groups).

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS combo_base_price     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS combo_available_from TIME,
  ADD COLUMN IF NOT EXISTS combo_available_to   TIME,
  ADD COLUMN IF NOT EXISTS combo_display_order  INTEGER NOT NULL DEFAULT 0;
-- "Show in POS" reuses the existing products.visible_on_pos (S27).

CREATE TABLE combo_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  group_type       TEXT NOT NULL CHECK (group_type IN ('single','multi')),
  is_required      BOOLEAN NOT NULL DEFAULT false,
  min_select       INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select       INTEGER NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (min_select <= max_select),
  CHECK (group_type <> 'single' OR max_select = 1),
  CHECK (NOT is_required OR min_select >= 1)
);
CREATE INDEX idx_combo_groups_combo ON combo_groups(combo_product_id, sort_order);

CREATE TABLE combo_group_options (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             UUID NOT NULL REFERENCES combo_groups(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  surcharge            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (surcharge >= 0),
  is_default           BOOLEAN NOT NULL DEFAULT false,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, component_product_id)
);
CREATE INDEX idx_combo_group_options_group ON combo_group_options(group_id, sort_order);

-- Parent-type guard: a group's combo must be product_type='combo'.
CREATE OR REPLACE FUNCTION enforce_combo_group_parent() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products
                 WHERE id = NEW.combo_product_id AND product_type = 'combo') THEN
    RAISE EXCEPTION 'combo_product_id must be a combo product'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_combo_groups_parent
  BEFORE INSERT OR UPDATE ON combo_groups
  FOR EACH ROW EXECUTE FUNCTION enforce_combo_group_parent();

-- Anti-nesting guard: an option cannot itself be a combo.
CREATE OR REPLACE FUNCTION enforce_combo_option_not_combo() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM products
             WHERE id = NEW.component_product_id AND product_type = 'combo') THEN
    RAISE EXCEPTION 'combo option cannot itself be a combo (no nested combos)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_combo_options_not_combo
  BEFORE INSERT OR UPDATE ON combo_group_options
  FOR EACH ROW EXECUTE FUNCTION enforce_combo_option_not_combo();

ALTER TABLE combo_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_group_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON combo_groups        FOR SELECT USING (is_authenticated());
CREATE POLICY "auth_read" ON combo_group_options FOR SELECT USING (is_authenticated());

REVOKE ALL ON combo_groups        FROM anon;
REVOKE ALL ON combo_group_options FROM anon;

-- Trigger functions are not callable via PostgREST but defense-in-depth
-- mirrors the pattern established in S40 (audit_role_permissions_changes).
REVOKE ALL ON FUNCTION enforce_combo_group_parent()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enforce_combo_group_parent()   FROM anon;
REVOKE ALL ON FUNCTION enforce_combo_option_not_combo() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION enforce_combo_option_not_combo() FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
