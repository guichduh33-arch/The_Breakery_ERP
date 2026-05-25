-- Session 31 / Wave 1.C — seed orders.read permission (MANAGER+)
--
-- Débloque le drill-down depuis SalesByStaff/AuditPage/PaymentByMethod vers
-- OrderDetailPage (route NEW S31 = /backoffice/orders/:id). Permission UI gate
-- uniquement — RLS row-level sur table orders reste authenticated SELECT, donc
-- pas de leak. CASHIER/WAITER continuent de voir leurs propres orders en POS
-- via les flux existants.

INSERT INTO permissions (code, module, action, description) VALUES
  ('orders.read', 'orders', 'read', 'View orders')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code)
SELECT r.code, 'orders.read'
FROM roles r
WHERE r.code IN ('MANAGER', 'ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
