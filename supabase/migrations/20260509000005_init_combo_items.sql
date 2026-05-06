-- 20260509000005_init_combo_items.sql
-- Session 7 / migration 5 : fixed combo components + parent-type guard trigger

CREATE TABLE combo_items (
  parent_product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity             INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_product_id, component_product_id),
  CHECK (parent_product_id <> component_product_id)
);

CREATE INDEX idx_combo_items_component
  ON combo_items(component_product_id);

CREATE OR REPLACE FUNCTION enforce_combo_parent_type() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM products WHERE id = NEW.parent_product_id AND product_type = 'combo'
  ) THEN
    RAISE EXCEPTION 'parent_product_id must be a combo product (product_type = ''combo'')'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM products WHERE id = NEW.component_product_id AND product_type = 'combo'
  ) THEN
    RAISE EXCEPTION 'component_product_id cannot itself be a combo (no nested combos in v1)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_combo_items_parent_type
  BEFORE INSERT OR UPDATE ON combo_items
  FOR EACH ROW EXECUTE FUNCTION enforce_combo_parent_type();

ALTER TABLE combo_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON combo_items FOR SELECT
  USING (is_authenticated());
