-- 20260530185630_revoke_pair_adjust_display_stock_v1.sql
-- REVOKE pair canonique S25.
REVOKE EXECUTE ON FUNCTION public.adjust_display_stock_v1(uuid, numeric, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_display_stock_v1(uuid, numeric, text, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
