-- 20260603000026_seed_accounting_cockpit_permissions.sql
-- Session 26 / Wave 1.I / migration _026 :
--   Seed permissions accounting cockpit + role_permissions pour
--   MANAGER, ADMIN, SUPER_ADMIN.

INSERT INTO permissions (code, module, action, description) VALUES
  ('accounting.period.close',     'accounting', 'period.close',
    'Close or lock a fiscal period (PIN gated)'),
  ('accounting.je.create_manual', 'accounting', 'je.create_manual',
    'Create a manual journal entry (PIN gated)'),
  ('accounting.gl.read',          'accounting', 'gl.read',
    'Read General Ledger drilldown by account'),
  ('accounting.tb.read',          'accounting', 'tb.read',
    'Read Trial Balance report'),
  ('accounting.coa.read',         'accounting', 'coa.read',
    'Read Chart of Accounts'),
  ('accounting.coa.write',        'accounting', 'coa.write',
    'Activate/deactivate accounts (super-admin only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'accounting.period.close'),
  ('ADMIN',       'accounting.period.close'),
  ('SUPER_ADMIN', 'accounting.period.close'),
  ('ADMIN',       'accounting.je.create_manual'),
  ('SUPER_ADMIN', 'accounting.je.create_manual'),
  ('MANAGER',     'accounting.gl.read'),
  ('ADMIN',       'accounting.gl.read'),
  ('SUPER_ADMIN', 'accounting.gl.read'),
  ('MANAGER',     'accounting.tb.read'),
  ('ADMIN',       'accounting.tb.read'),
  ('SUPER_ADMIN', 'accounting.tb.read'),
  ('MANAGER',     'accounting.coa.read'),
  ('ADMIN',       'accounting.coa.read'),
  ('SUPER_ADMIN', 'accounting.coa.read'),
  ('SUPER_ADMIN', 'accounting.coa.write')
ON CONFLICT (role_code, permission_code) DO NOTHING;
