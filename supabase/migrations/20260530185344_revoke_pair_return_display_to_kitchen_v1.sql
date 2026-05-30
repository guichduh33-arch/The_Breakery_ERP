-- 20260530185344_revoke_pair_return_display_to_kitchen_v1.sql
-- REVOKE pair canonique S25.
REVOKE EXECUTE ON FUNCTION public.return_display_to_kitchen_v1(uuid, numeric, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.return_display_to_kitchen_v1(uuid, numeric, text, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
