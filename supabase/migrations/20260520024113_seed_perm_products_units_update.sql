-- Session 27 / Wave 1.A.5 — Seed permission products.units.update + grant to SUPER_ADMIN/ADMIN/MANAGER.

INSERT INTO permissions (code, module, action, description) VALUES
  ('products.units.update', 'products', 'update',
   'Edit product unit alternatives and unit contexts')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
  SELECT r.code, 'products.units.update'
  FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(code)
ON CONFLICT DO NOTHING;
