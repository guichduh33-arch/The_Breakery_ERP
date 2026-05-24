-- 20260606000018_revoke_pair_sign_zreport_v1.sql
-- S29 Wave 1.C.1 — REVOKE pair for sign_zreport_v1 (S25 canonical pattern).
REVOKE EXECUTE ON FUNCTION sign_zreport_v1(UUID) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
