-- Session 27c / Wave 2 — Canonical REVOKE pair (S20 pattern).

REVOKE EXECUTE ON FUNCTION convert_parent_to_standalone_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_parent_to_standalone_v1(UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
