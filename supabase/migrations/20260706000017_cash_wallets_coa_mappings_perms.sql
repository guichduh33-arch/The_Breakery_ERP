-- 20260706000017 — Cash Wallets module : COA accounts + mapping keys + permissions.
-- 3-wallet treasury (Undeposited 1110 / Petty 1111 / Small Money 1117).

-- (a) New accounts (idempotent)
INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active) VALUES
  ('1117', 'Small Money (Change Float)', 1, 'asset',  'debit', true, true, true),
  ('3110', 'Owner''s Drawing',           3, 'equity', 'debit', true, true, true)
ON CONFLICT (code) DO NOTHING;

-- (b) Mapping keys (idempotent)
INSERT INTO accounting_mappings (mapping_key, account_code, description, is_active) VALUES
  ('CASH_WALLET_UNDEPOSITED', '1110', 'Cash wallet: Undeposited Funds (main safe)', true),
  ('CASH_WALLET_PETTY',       '1111', 'Cash wallet: Petty Cash (daily expenses)',   true),
  ('CASH_WALLET_SMALL_MONEY', '1117', 'Cash wallet: Small Money (change float)',     true),
  ('CASH_BANK_OPERATING',     '1112', 'Cash wallet: bank deposit target',            true),
  ('OWNER_DRAWING',           '3110', 'Cash wallet: Boss withdrawal (owner drawing)', true)
ON CONFLICT (mapping_key) DO NOTHING;

-- (c) Permissions (idempotent)
INSERT INTO permissions (code, module, action, description) VALUES
  ('accounting.cash.read',  'accounting', 'cash.read',  'Read the cash treasury wallets and ledgers'),
  ('accounting.cash.write', 'accounting', 'cash.write', 'Record a cash wallet movement (posts a JE)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'accounting.cash.read'),
  ('ADMIN',       'accounting.cash.read'),
  ('SUPER_ADMIN', 'accounting.cash.read'),
  ('MANAGER',     'accounting.cash.write'),
  ('ADMIN',       'accounting.cash.write'),
  ('SUPER_ADMIN', 'accounting.cash.write')
ON CONFLICT DO NOTHING;
