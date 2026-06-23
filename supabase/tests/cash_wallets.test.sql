-- Cash Wallets / Trésorerie — pgTAP suite.
-- Run via MCP execute_sql against ikcyvlovptebroadgtvd, wrapped in BEGIN…ROLLBACK.
-- NOTE: write-path cases stub public.has_permission to TRUE inside the txn so the
-- SECURITY DEFINER RPC's gate passes for the test caller; ROLLBACK restores it.

BEGIN;
SELECT plan(7);

-- ── Task 1: COA accounts, mappings, permissions ───────────────────────────────
SELECT ok( (SELECT is_postable FROM accounts WHERE code='1117'), '1117 Small Money is postable');
SELECT is( (SELECT account_type FROM accounts WHERE code='1117'), 'asset', '1117 is an asset');
SELECT is( (SELECT balance_type FROM accounts WHERE code='3110'), 'debit', '3110 Owner Drawing is debit-balance');

SELECT is( (SELECT code FROM accounts WHERE id = resolve_mapping_account('CASH_WALLET_SMALL_MONEY')), '1117', 'small-money mapping → 1117');
SELECT is( (SELECT code FROM accounts WHERE id = resolve_mapping_account('OWNER_DRAWING')), '3110', 'owner-drawing mapping → 3110');

SELECT ok( EXISTS(SELECT 1 FROM permissions WHERE code='accounting.cash.write'), 'cash.write permission exists');
SELECT ok( EXISTS(SELECT 1 FROM role_permissions WHERE role_code='MANAGER' AND permission_code='accounting.cash.write'), 'MANAGER has cash.write');

SELECT * FROM finish();
ROLLBACK;
