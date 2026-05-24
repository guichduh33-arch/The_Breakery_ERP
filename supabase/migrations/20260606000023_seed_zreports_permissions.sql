-- 20260606000023_seed_zreports_permissions.sql
-- S29 Wave 1.D.1 — seed 3 permissions zreports.{read,sign,void} + role_permissions.
-- Note: permissions table uses (code, module, action, description) — no name/category cols.
-- role_permissions table uses (role_code, permission_code, is_granted).

INSERT INTO permissions (code, module, action, description) VALUES
  ('zreports.read', 'zreports', 'read',   'View Z-Report history and PDF archives.'),
  ('zreports.sign', 'zreports', 'update', 'Sign a Z-Report draft (PIN-gated).'),
  ('zreports.void', 'zreports', 'delete', 'Void a signed Z-Report with reason (admin only).')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('MANAGER',     'zreports.read', true),
  ('MANAGER',     'zreports.sign', true),
  ('ADMIN',       'zreports.read', true),
  ('ADMIN',       'zreports.sign', true),
  ('ADMIN',       'zreports.void', true),
  ('SUPER_ADMIN', 'zreports.read', true),
  ('SUPER_ADMIN', 'zreports.sign', true),
  ('SUPER_ADMIN', 'zreports.void', true)
ON CONFLICT (role_code, permission_code) DO NOTHING;
