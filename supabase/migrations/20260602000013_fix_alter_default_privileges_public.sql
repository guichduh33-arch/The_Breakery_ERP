-- Session 25 — Phase 1.A.1 — _013 (corrective, per code reviewer feedback)
-- The _012 migration's ALTER DEFAULT PRIVILEGES targeted only `FROM anon`, missing
-- the `FROM PUBLIC` clause that the S20 canonical pattern requires (see CLAUDE.md
-- "Anon GRANT defense-in-depth (S20)" — anon inherits EXECUTE through PUBLIC via
-- the =X/postgres ACL entry, so both REVOKEs are needed for future-proofing).
--
-- Currently a no-op because the S20 global sweep `20260524000031` already set
-- the PUBLIC default privilege. This migration re-asserts it explicitly so that
-- _012 + _013 together form a complete S20-canonical template for future per-RPC
-- defense-in-depth migrations.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
