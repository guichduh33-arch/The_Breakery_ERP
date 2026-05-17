-- 20260524000030_revoke_anon_execute_from_public_functions.sql
-- Session 20 / Wave 2.5 — REVOKE EXECUTE FROM anon on all public functions.
--
-- Audit 2026-05-17 found 100 SECURITY DEFINER + 1331 SECURITY INVOKER
-- functions anon-EXECUTABLE in public (incl. complete_order_with_payment_v9,
-- delete_user_v1, adjust_stock_v1, etc.). No legitimate anon RPC consumer
-- exists in this project (auth EFs use service_role ; kiosks use kiosk-JWT
-- under authenticated). S19 set the precedent with the corrective
-- 20260523000022_fix_update_role_session_timeout_v1_revoke_anon.sql ; this
-- is the project-wide sweep.
--
-- ALTER DEFAULT PRIVILEGES is only applied for the `postgres` role; the
-- `supabase_admin` role's defaults are platform-managed and cannot be
-- modified by user migrations (DEV-S20-2.A-02). The 14 residual anon
-- grants on supabase_admin-owned pgtap extension views observed in
-- Phase 2.A may have equivalents in the function space (pgtap helper
-- functions) — same justification, same exclusion in pgTAP A2.

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Future-proof — postgres-owned functions only (supabase_admin unreachable).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
