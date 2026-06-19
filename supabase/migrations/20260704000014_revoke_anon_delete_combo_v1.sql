-- 20260704000014_revoke_anon_delete_combo_v1.sql
-- Session 47 / Wave A — canonical REVOKE pair for delete_combo_v1.

REVOKE EXECUTE ON FUNCTION public.delete_combo_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_combo_v1(uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
