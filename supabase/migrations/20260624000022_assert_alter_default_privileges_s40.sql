-- 20260624000022_assert_alter_default_privileges_s40.sql
-- S40 corrective (DEV-S40-D-01, pattern-guardian P11 ×12) — the 12 S40
-- migrations carried only the 2 function-level REVOKE lines and omitted the
-- canonical 3rd defense-in-depth line. It is a no-op at runtime (the S20
-- global sweep already set it project-wide — DEV-S25-1.A-02), but the S25
-- _012/_013 pair convention requires it to be re-asserted per REVOKE block
-- so future schema-ownership changes can't silently re-grant PUBLIC EXECUTE.
-- One assertion here closes all 12 findings.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
