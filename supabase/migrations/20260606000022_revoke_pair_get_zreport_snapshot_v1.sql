-- 20260606000022_revoke_pair_get_zreport_snapshot_v1.sql
-- S29 Wave 1.C.3 — REVOKE pair for get_zreport_snapshot_v1 (S25 canonical pattern).
REVOKE EXECUTE ON FUNCTION get_zreport_snapshot_v1(UUID) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
