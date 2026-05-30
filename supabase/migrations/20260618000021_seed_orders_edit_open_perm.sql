-- 20260618000021_seed_orders_edit_open_perm.sql
-- Session 33 / Wave 1.8 — seed orders.edit_open + orders.void permissions.
-- Both are MANAGER+ / ADMIN+ / SUPER_ADMIN grants.

INSERT INTO permissions (code, module, action, description)
VALUES
  ('orders.edit_open', 'orders', 'edit_open', 'Edit items on open orders from BO'),
  ('orders.void',      'orders', 'void',      'Void orders (manager action)')
ON CONFLICT (code) DO NOTHING;

-- Grant to MANAGER, ADMIN, SUPER_ADMIN
INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT r.code, p.code, true
FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
CROSS JOIN (VALUES ('orders.edit_open'), ('orders.void')) AS p(code)
ON CONFLICT (role_code, permission_code) DO NOTHING;
