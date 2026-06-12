-- 20260625000013_seed_catalog_import_export_perms.sql
-- S41 — seed catalog.import + catalog.export, granted to MANAGER/ADMIN/SUPER_ADMIN.

INSERT INTO permissions (code, module, action, description) VALUES
  ('catalog.import', 'products', 'create',
   'Bulk import the catalog (products, recipes, variants, units) from the BO Import/Export tab'),
  ('catalog.export', 'products', 'read',
   'Export the full catalog (includes cost prices) in the import template shape')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, p.perm
  FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
 CROSS JOIN (VALUES ('catalog.import'), ('catalog.export')) AS p(perm)
ON CONFLICT DO NOTHING;
