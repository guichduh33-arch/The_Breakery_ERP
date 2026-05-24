-- S28 corrective — wave 7.E.2
-- REVOKE pair for sync_cash_expense_to_session() trigger function.
-- Project convention (S25 canonical + DEV-S19-1.B-02): ALL public-schema functions
-- receive a REVOKE pair, even trigger functions that are never called directly.
REVOKE EXECUTE ON FUNCTION sync_cash_expense_to_session() FROM anon;
REVOKE EXECUTE ON FUNCTION sync_cash_expense_to_session() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
