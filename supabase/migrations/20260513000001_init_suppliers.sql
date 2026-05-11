-- 20260513000001_init_suppliers.sql
-- Session 11 — suppliers table (preliminary for session 12 inventory module).

CREATE TABLE suppliers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  contact_phone      TEXT,
  contact_email      TEXT,
  address            TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ
);

CREATE INDEX idx_suppliers_active
  ON suppliers(name)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read"   ON suppliers FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL);
CREATE POLICY "perm_create" ON suppliers FOR INSERT
  WITH CHECK (has_permission(auth.uid(), 'suppliers.create'));
CREATE POLICY "perm_update" ON suppliers FOR UPDATE
  USING (has_permission(auth.uid(), 'suppliers.update'));

COMMENT ON TABLE suppliers IS
  'Session 11: vendor catalog. Preliminary for session 12 inventory receiving + purchase orders.';
