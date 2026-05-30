-- 20260530185129_seed_display_permissions.sql
-- Seed display.read (consultation POS+BO) + display.manage (gestes vitrine).
-- NOTE : ces deux codes préexistaient via le module "customer display screens"
-- (init_display_screens). ON CONFLICT DO NOTHING conserve donc les descriptions
-- d'origine ; seuls comptent ici les grants de rôle (tout staff peut gérer la vitrine).

INSERT INTO permissions (code, module, action, description) VALUES
  ('display.read',   'display', 'read',   'View display-case (vitrine) stock'),
  ('display.manage', 'display', 'manage', 'Manage display-case stock (add/return/waste/adjust)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, p.code
FROM roles r
CROSS JOIN (VALUES ('display.read'), ('display.manage')) AS p(code)
WHERE r.code IN ('CASHIER', 'waiter', 'MANAGER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
