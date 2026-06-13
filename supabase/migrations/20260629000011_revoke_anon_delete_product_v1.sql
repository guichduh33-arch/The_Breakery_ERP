-- 20260629000011_revoke_anon_delete_product_v1.sql
-- Session 45 / Wave A — Canonical S25 REVOKE pair (5 lines) for delete_product_v1.
-- Ensures anon cannot execute this admin-only RPC even via PUBLIC inheritance.
-- GRANT is restricted to authenticated (gated internally by has_permission check).
GRANT EXECUTE ON FUNCTION public.delete_product_v1(UUID, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_product_v1(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_product_v1(UUID, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
