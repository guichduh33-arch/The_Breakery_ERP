-- 20260706000019 — Cash Wallets : route cash expenses to Petty Cash, drop shift-drawer sync.
-- Cash expenses now CR 1111 Petty Cash (the safe), not 1110. Daily expenses leave the
-- Petty Cash wallet, not the active POS till. Forward-only: historical JE untouched.

UPDATE accounting_mappings
   SET account_code = '1111',
       description  = 'Expense paid cash/transfer/card -> CR Petty Cash (cash wallets module)'
 WHERE mapping_key = 'EXPENSE_CASH_OUT';

DROP TRIGGER IF EXISTS trg_expenses_sync_cash ON expenses;
DROP FUNCTION IF EXISTS sync_cash_expense_to_session();
