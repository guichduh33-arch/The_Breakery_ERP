-- S28 Wave 2.B — REVOKE pair (S25 canonical) for submit_expense_v2
-- Prevents anon (and PUBLIC inheritance) from calling the RPC directly.
-- The ALTER DEFAULT PRIVILEGES line is idempotent project-wide (set since S20)
-- but kept for defense-in-depth template alignment (canonical REVOKE pair pattern).
REVOKE EXECUTE ON FUNCTION submit_expense_v2(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION submit_expense_v2(UUID, UUID) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
