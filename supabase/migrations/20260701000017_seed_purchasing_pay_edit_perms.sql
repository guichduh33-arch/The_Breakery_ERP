-- 20260701000017_seed_purchasing_pay_edit_perms.sql
-- Session 46 / Wave A7 — Seed purchasing.po.pay and purchasing.po.edit permissions.
--
-- Mirrors the existing purchasing.po.{read,create,receive,cancel} pattern from
-- migration 20260517000110_init_purchase_orders.sql (§6):
--   • INSERT INTO permissions (code, module, action, description)
--   • INSERT INTO role_permissions (role_code, permission_code, is_granted)
--   • Granted to: SUPER_ADMIN, ADMIN, MANAGER (same as the 4 existing perms)
--   • CASHIER and other roles: not granted (write operations)
--
-- ON CONFLICT DO NOTHING for idempotency.

INSERT INTO permissions (code, module, action, description) VALUES
  ('purchasing.po.pay',  'purchasing', 'pay',  'Record payments against a purchase order'),
  ('purchasing.po.edit', 'purchasing', 'edit', 'Edit a pending purchase order header and line items')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted) VALUES
  ('SUPER_ADMIN', 'purchasing.po.pay',  TRUE),
  ('SUPER_ADMIN', 'purchasing.po.edit', TRUE),
  ('ADMIN',       'purchasing.po.pay',  TRUE),
  ('ADMIN',       'purchasing.po.edit', TRUE),
  ('MANAGER',     'purchasing.po.pay',  TRUE),
  ('MANAGER',     'purchasing.po.edit', TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;
