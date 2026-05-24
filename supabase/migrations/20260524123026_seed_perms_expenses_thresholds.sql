INSERT INTO permissions (code, module, action, description) VALUES
  ('expenses.thresholds.read',  'expenses', 'read',   'Read expense approval thresholds (settings page + UI badges).'),
  ('expenses.thresholds.write', 'expenses', 'update', 'Configure expense approval thresholds (admin-only).')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('CASHIER',     'expenses.thresholds.read',  true),
  ('MANAGER',     'expenses.thresholds.read',  true),
  ('ADMIN',       'expenses.thresholds.read',  true),
  ('SUPER_ADMIN', 'expenses.thresholds.read',  true),
  ('ADMIN',       'expenses.thresholds.write', true),
  ('SUPER_ADMIN', 'expenses.thresholds.write', true)
ON CONFLICT (role_code, permission_code) DO NOTHING;
