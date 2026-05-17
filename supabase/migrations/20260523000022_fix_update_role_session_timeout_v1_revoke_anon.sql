-- 20260523000022_fix_update_role_session_timeout_v1_revoke_anon.sql
-- Session 19 / Phase 1.B — Corrective : REVOKE EXECUTE from anon explicitly.
--
-- Supabase default-grants EXECUTE on all public functions to anon + authenticated
-- + service_role via `ALTER DEFAULT PRIVILEGES IN SCHEMA public ... TO anon`.
-- `REVOKE ALL FROM PUBLIC` in 20260523000021 does NOT cancel an explicit grant
-- to anon. We harden the surface by revoking anon's direct grant. The RPC's
-- internal `auth.uid() IS NULL` check would still reject unauthenticated callers,
-- but defence-in-depth says keep this admin-only RPC off the anon role entirely.

REVOKE EXECUTE ON FUNCTION update_role_session_timeout_v1(TEXT, INT) FROM anon;
