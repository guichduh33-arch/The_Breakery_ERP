-- 20260813000004_seed_orders_refund_reprint_perms.sql
-- Money-path UX/UI lot 6b — ouvre le refund/void cross-shift depuis le back-office.
-- Seed des permissions orders.refund + orders.reprint_receipt, accordees a
-- MANAGER / ADMIN / SUPER_ADMIN. Patron identique au seed historique
-- 20260618000021_seed_orders_edit_open_perm.sql.

INSERT INTO permissions (code, module, action, description)
VALUES
  ('orders.refund',          'orders', 'refund',          'Refund orders cross-shift from the back-office (manager action)'),
  ('orders.reprint_receipt', 'orders', 'reprint_receipt', 'Reprint order receipts from the back-office')
ON CONFLICT (code) DO NOTHING;

-- Grant to MANAGER, ADMIN, SUPER_ADMIN
INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT r.code, p.code, true
FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS r(code)
CROSS JOIN (VALUES ('orders.refund'), ('orders.reprint_receipt')) AS p(code)
ON CONFLICT (role_code, permission_code) DO NOTHING;
