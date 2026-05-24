-- 20260615000011_revoke_pair_get_wastage_report_v1.sql
-- S30 Wave 1.A.1 — REVOKE pair (S25 canonical pattern).
REVOKE EXECUTE ON FUNCTION get_wastage_report_v1(TEXT, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
