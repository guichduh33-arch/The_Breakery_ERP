-- 20260606000020_revoke_pair_void_zreport_v1.sql
-- S29 Wave 1.C.2 — REVOKE pair for void_zreport_v1 (S25 canonical pattern).
REVOKE EXECUTE ON FUNCTION void_zreport_v1(UUID, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
