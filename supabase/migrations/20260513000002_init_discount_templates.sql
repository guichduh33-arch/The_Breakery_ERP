-- 20260513000002_init_discount_templates.sql
-- Session 11 — preset discount templates that managers can pre-configure for cashiers.
-- v1: stored only ; consumption side (POS DiscountModal preset picker) is deferred to session 11b/15.

CREATE TYPE discount_template_type AS ENUM ('percentage', 'fixed_amount');

CREATE TABLE discount_templates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  type                   discount_template_type NOT NULL,
  value                  DECIMAL(14,2) NOT NULL CHECK (value > 0),
  /* When true, applying this preset always requires manager PIN regardless of threshold. */
  requires_pin           BOOLEAN NOT NULL DEFAULT false,
  /* Cashier-only threshold (e.g. 5%) above which PIN is required. NULL → fall back to requires_pin. */
  cashier_max_percentage DECIMAL(5,2)
    CHECK (cashier_max_percentage IS NULL OR (cashier_max_percentage >= 0 AND cashier_max_percentage <= 100)),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ,
  CONSTRAINT chk_value_consistency CHECK (
    (type = 'percentage' AND value > 0 AND value <= 100)
    OR (type = 'fixed_amount' AND value > 0)
  )
);

CREATE INDEX idx_discount_templates_active
  ON discount_templates(name)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE TRIGGER discount_templates_set_updated_at
  BEFORE UPDATE ON discount_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE discount_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read"   ON discount_templates FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON discount_templates FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'discount_templates.create'));
CREATE POLICY "perm_update" ON discount_templates FOR UPDATE
  USING (has_permission(auth.uid(), 'discount_templates.update'));

COMMENT ON TABLE discount_templates IS
  'Session 11: discount presets. Stored-only v1 ; POS preset picker wire-up deferred to session 15.';
