-- 20260710000066_seed_b2b_payment_record_cancel_perms.sql
-- S52 P1.2 — dedicated B2B perms (replace generic customers.update gate on payment recording;
-- new cancel gate). Grant set mirrors current customers.update holders: SUPER_ADMIN/ADMIN/MANAGER.
INSERT INTO permissions (code, module, action, description) VALUES
  ('b2b.payment.record', 'b2b', 'payment_record', 'Record a B2B customer payment and allocate it to invoices'),
  ('b2b.order.cancel',   'b2b', 'order_cancel',   'Cancel an unpaid B2B invoice (reverses JE + stock + AR balance)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_at) VALUES
  ('SUPER_ADMIN', 'b2b.payment.record', true, now()),
  ('ADMIN',       'b2b.payment.record', true, now()),
  ('MANAGER',     'b2b.payment.record', true, now()),
  ('SUPER_ADMIN', 'b2b.order.cancel',   true, now()),
  ('ADMIN',       'b2b.order.cancel',   true, now()),
  ('MANAGER',     'b2b.order.cancel',   true, now())
ON CONFLICT (role_code, permission_code) DO NOTHING;
