-- Session 27c / Wave 3.A — Seed 2 new permissions for variants management.
-- products.variants.read  → MANAGER, ADMIN, SUPER_ADMIN
-- products.variants.write → ADMIN, SUPER_ADMIN

INSERT INTO permissions (code, module, action, description) VALUES
  ('products.variants.read',  'products', 'read',
   'Read variants under a parent product'),
  ('products.variants.write', 'products', 'update',
   'Create/update/delete variants and parent linkage')
ON CONFLICT (code) DO NOTHING;

-- Grant read to MANAGER, ADMIN, SUPER_ADMIN.
INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'products.variants.read'
  FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
ON CONFLICT DO NOTHING;

-- Grant write to ADMIN, SUPER_ADMIN.
INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'products.variants.write'
  FROM (VALUES ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
ON CONFLICT DO NOTHING;
