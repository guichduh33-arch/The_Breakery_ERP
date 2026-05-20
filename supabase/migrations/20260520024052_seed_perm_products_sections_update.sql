-- Session 27 / Wave 1.A.5 — Seed permission products.sections.update + grant to SUPER_ADMIN/ADMIN/MANAGER.

INSERT INTO permissions (code, module, action, description) VALUES
  ('products.sections.update', 'products', 'update',
   'Edit product section assignments and primary section')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
  SELECT r.code, 'products.sections.update'
  FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(code)
ON CONFLICT DO NOTHING;
