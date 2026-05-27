-- 20260617000014_revoke_anon_get_orders_list_v1.sql
-- Session 32 / Wave 1.F :
--   REVOKE pair canonique S25 sur get_orders_list_v1.
--   Pattern : REVOKE FROM PUBLIC + REVOKE FROM anon + ALTER DEFAULT PRIVILEGES.
--   Defense-in-depth — orders.read gate within the function body is primary defense,
--   this REVOKE prevents anon-callable function exposure even if PUBLIC EXECUTE grant
--   were re-granted by accident.

REVOKE EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
