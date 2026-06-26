-- 20260710000053_seed_b2b_settings_security_perms.sql
-- Session 50 / W1.3 — Seed deux permissions manquantes.
--
-- b2b.read     : accès à la liste B2B clients, factures en attente, vues AR.
--   → MANAGER, ADMIN, SUPER_ADMIN (équivalent à accounting.gl.read).
--   Les RPCs B2B existants (record_b2b_payment_v1, adjust_b2b_balance_v1,
--   create_b2b_order_v1) ont déjà leur propre gate ou REVOKE ; cette permission
--   est destinée aux gates futures sur view_b2b_invoices / view_ar_aging.
--
-- settings.security.manage : modification des seuils de sécurité (PIN policy,
--   rate-limit, Leaked Password Protection toggle, MFA obligatoire).
--   → ADMIN, SUPER_ADMIN uniquement (SOD : manager ne peut pas affaiblir la policy).
--
-- DEV-S50-W1.3

INSERT INTO permissions (code, module, action, description) VALUES
  ('b2b.read',
   'b2b',
   'read',
   'Read B2B customer profiles, invoices, and AR aging reports'),
  ('settings.security.manage',
   'settings',
   'security.manage',
   'Modify security settings: PIN policy, rate-limit thresholds, Leaked Password Protection, MFA policy')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
VALUES
  ('MANAGER',     'b2b.read', true),
  ('ADMIN',       'b2b.read', true),
  ('SUPER_ADMIN', 'b2b.read', true),
  ('ADMIN',       'settings.security.manage', true),
  ('SUPER_ADMIN', 'settings.security.manage', true)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = true;
