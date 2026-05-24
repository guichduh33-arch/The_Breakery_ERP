-- 20260615000019_revoke_pair_get_perishable_turnover_v1.sql
-- S30 Wave 1.A.3 — REVOKE pair (S25 canonical pattern).
REVOKE EXECUTE ON FUNCTION get_perishable_turnover_v1(TEXT, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
