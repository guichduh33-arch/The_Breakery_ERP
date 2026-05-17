-- 20260524000031_fix_revoke_public_execute_from_public_functions.sql
-- Session 20 / Wave 2.5 — Corrective: also REVOKE EXECUTE FROM PUBLIC.
--
-- Migration 20260524000030 ran REVOKE EXECUTE ... FROM anon, which removed
-- the named-anon ACL entry, but left the PUBLIC (=X/postgres) grant intact.
-- anon inherits EXECUTE through PUBLIC membership, so the 81 postgres-owned
-- functions remained anon-accessible. This corrective also revokes from PUBLIC
-- and updates ALTER DEFAULT PRIVILEGES accordingly.
--
-- The named-role grants (authenticated, service_role) are preserved.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Update default privileges: strip PUBLIC from future postgres-owned functions.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
