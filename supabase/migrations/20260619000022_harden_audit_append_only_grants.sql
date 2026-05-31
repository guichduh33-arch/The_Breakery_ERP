-- 20260619000022_harden_audit_append_only_grants.sql
-- Security hardening (security-fraud-guard audit 2026-05-31, Pattern #2 / #7, checklist E).
--
-- GAP 7 — audit tables are not append-only at the GRANT level.
-- Both audit_logs (canonical) and audit_log (legacy) had
-- has_table_privilege('authenticated', …, 'INSERT'/'UPDATE'/'DELETE') = true
-- (verified live). Append-only therefore rested on RLS alone — a weaker guarantee
-- than the true GRANT-revoked ledgers (stock_movements, b2b_payments, …). A caller
-- who finds (or a future migration that adds) a permissive RLS policy could rewrite
-- or delete history, defeating non-repudiation.
--
-- Fix: REVOKE INSERT/UPDATE/DELETE FROM authenticated (and anon, PUBLIC for
-- defense-in-depth). All legitimate writes go through SECURITY DEFINER RPCs
-- (run as owner) or the service-role admin client in Edge Functions — neither is
-- affected by these grants. SELECT is intentionally preserved (the audit viewer
-- reads through get_audit_logs_v1; the read gate lives at the RLS/RPC layer).
--
-- Verified before shipping: no application code performs a direct
-- `.from('audit_log[s]').insert/update/delete` as `authenticated`
-- (grep apps/ packages/ → no matches); refund-order EF uses getAdminClient()
-- (service_role, unaffected). service_role retains INSERT on audit_logs.

REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated, anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log  FROM authenticated, anon, PUBLIC;
