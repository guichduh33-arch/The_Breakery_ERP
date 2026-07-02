-- S54 P1.3 · T6 — permission dédiée clôture annuelle (mirror _026)
INSERT INTO permissions (code, module, action, description) VALUES
  ('accounting.year.close', 'accounting', 'year.close',
    'Close a fiscal year: carry-forward P&L to 3200 Retained Earnings (PIN gated)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'accounting.year.close'),
  ('ADMIN',       'accounting.year.close'),
  ('SUPER_ADMIN', 'accounting.year.close')
ON CONFLICT (role_code, permission_code) DO NOTHING;
