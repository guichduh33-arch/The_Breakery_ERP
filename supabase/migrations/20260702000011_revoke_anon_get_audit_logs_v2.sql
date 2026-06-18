-- 20260702000011_revoke_anon_get_audit_logs_v2.sql
-- Canonical REVOKE pair for get_audit_logs_v2 (S20/S25 anon defense-in-depth).
--
-- Supabase auto-grants EXECUTE on public functions to PUBLIC (and therefore
-- anon, via PUBLIC membership). `REVOKE ... FROM anon` alone is insufficient —
-- the `=X/postgres` PUBLIC ACL entry must be revoked too, plus the default
-- privilege so future re-creates inherit the lockdown.

REVOKE EXECUTE ON FUNCTION public.get_audit_logs_v2(TIMESTAMPTZ, INT, UUID, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_audit_logs_v2(TIMESTAMPTZ, INT, UUID, TEXT, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_audit_logs_v2(TIMESTAMPTZ, INT, UUID, TEXT, TEXT, UUID) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
