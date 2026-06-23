-- Cash Wallets / Trésorerie — pgTAP suite.
-- Run via MCP execute_sql against ikcyvlovptebroadgtvd, wrapped in BEGIN…ROLLBACK.
-- NOTE: write-path cases stub public.has_permission to TRUE inside the txn so the
-- SECURITY DEFINER RPC's gate passes for the test caller (auth.uid() is NULL under
-- execute_sql); ROLLBACK restores the real function.

BEGIN;

-- Stub the permission gate for write-path cases (rolled back at COMMIT/ROLLBACK).
CREATE OR REPLACE FUNCTION public.has_permission(p_uid uuid, p_perm text)
RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

SELECT plan(22);

-- ── Task 1: COA accounts, mappings, permissions ───────────────────────────────
SELECT ok( (SELECT is_postable FROM accounts WHERE code='1117'), '1117 Small Money is postable');
SELECT is( (SELECT account_type FROM accounts WHERE code='1117'), 'asset', '1117 is an asset');
SELECT is( (SELECT balance_type FROM accounts WHERE code='3110'), 'debit', '3110 Owner Drawing is debit-balance');
SELECT is( (SELECT code FROM accounts WHERE id = resolve_mapping_account('CASH_WALLET_SMALL_MONEY')), '1117', 'small-money mapping → 1117');
SELECT is( (SELECT code FROM accounts WHERE id = resolve_mapping_account('OWNER_DRAWING')), '3110', 'owner-drawing mapping → 3110');
SELECT ok( EXISTS(SELECT 1 FROM permissions WHERE code='accounting.cash.write'), 'cash.write permission exists');
SELECT ok( EXISTS(SELECT 1 FROM role_permissions WHERE role_code='MANAGER' AND permission_code='accounting.cash.write'), 'MANAGER has cash.write');

-- ── Task 2: record_cash_wallet_movement_v1 ───────────────────────────────────────────
DO $$
DECLARE v_je uuid;
BEGIN
  v_je := record_cash_wallet_movement_v1('undepo_to_petty', 100000, CURRENT_DATE, 'test transfer',
                                  '11111111-1111-1111-1111-111111111111', NULL);
  PERFORM set_config('cash.test_je', v_je::text, true);
END $$;

SELECT is(
  (SELECT debit FROM journal_entry_lines jel JOIN accounts a ON a.id=jel.account_id
   WHERE jel.journal_entry_id=current_setting('cash.test_je')::uuid AND a.code='1111'),
  100000::numeric, 'undepo_to_petty debits Petty Cash 1111');
SELECT is(
  (SELECT credit FROM journal_entry_lines jel JOIN accounts a ON a.id=jel.account_id
   WHERE jel.journal_entry_id=current_setting('cash.test_je')::uuid AND a.code='1110'),
  100000::numeric, 'undepo_to_petty credits Undeposited 1110');
SELECT is(
  (SELECT total_debit FROM journal_entries WHERE id=current_setting('cash.test_je')::uuid),
  (SELECT total_credit FROM journal_entries WHERE id=current_setting('cash.test_je')::uuid),
  'JE is balanced');
SELECT is(
  record_cash_wallet_movement_v1('undepo_to_petty',100000,CURRENT_DATE,'test transfer',
                          '11111111-1111-1111-1111-111111111111',NULL),
  current_setting('cash.test_je')::uuid, 'replay returns the first JE id');
SELECT throws_ok(
  $q$ SELECT record_cash_wallet_movement_v1('bank_deposit',-5,CURRENT_DATE,'x',
        '22222222-2222-2222-2222-222222222222',NULL) $q$,
  'P0001', NULL, 'non-positive amount rejected');
SELECT throws_ok(
  $q$ SELECT record_cash_wallet_movement_v1('teleport',5,CURRENT_DATE,'x',
        '33333333-3333-3333-3333-333333333333',NULL) $q$,
  'P0001', NULL, 'unknown movement type rejected');
SELECT throws_ok(
  $q$ SELECT record_cash_wallet_movement_v1('adjustment_gain',5,CURRENT_DATE,'count over',
        '44444444-4444-4444-4444-444444444444',NULL) $q$,
  'P0001', NULL, 'adjustment requires p_wallet_code');
SELECT is(
  has_function_privilege('anon','record_cash_wallet_movement_v1(text,numeric,date,text,uuid,text)','EXECUTE'),
  false, 'anon has no EXECUTE on record_cash_wallet_movement_v1');

-- ── Task 4: read RPCs (balances + ledger) ─────────────────────────────────────
DO $$
BEGIN
  PERFORM record_cash_wallet_movement_v1('undepo_to_petty',100000,CURRENT_DATE,'replenish',
                                         'aaaa1111-1111-1111-1111-111111111111',NULL);
  PERFORM record_cash_wallet_movement_v1('bank_deposit',50000,CURRENT_DATE,'deposit',
                                         'aaaa2222-2222-2222-2222-222222222222',NULL);
END $$;

SELECT ok( EXISTS(SELECT 1 FROM get_cash_wallet_balances_v1() WHERE account_code='1110'), 'balances include 1110');
SELECT ok( EXISTS(SELECT 1 FROM get_cash_wallet_balances_v1() WHERE account_code='1117'), 'balances include 1117');
SELECT cmp_ok(
  (SELECT count(*)::int FROM get_cash_wallet_ledger_v1('1111', CURRENT_DATE-1, CURRENT_DATE+1)), '>=', 1,
  'petty ledger returns at least the transfer row');
SELECT is(
  (SELECT in_amount FROM get_cash_wallet_ledger_v1('1111', CURRENT_DATE-1, CURRENT_DATE+1)
   WHERE remark LIKE '%replenish%' LIMIT 1),
  100000::numeric, 'petty In row = 100000');
SELECT cmp_ok(
  (SELECT count(*)::int FROM get_cash_wallet_ledger_v1('1110', CURRENT_DATE-1, CURRENT_DATE+1)), '>=', 1,
  'undeposited ledger executes and returns rows');

-- ── Task 9: analysis RPC ──────────────────────────────────────────────────────
SELECT ok( (get_cash_wallet_analysis_v1(CURRENT_DATE-31, CURRENT_DATE+1)) ? 'revenue_by_shift',
  'analysis payload has revenue_by_shift key');
SELECT is( has_function_privilege('anon','get_cash_wallet_analysis_v1(date,date)','EXECUTE'), false,
  'anon has no EXECUTE on get_cash_wallet_analysis_v1');

SELECT * FROM finish();
ROLLBACK;
