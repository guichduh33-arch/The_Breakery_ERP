-- 20260704000012_revoke_anon_upsert_combo_v1.sql
-- Session 47 / Wave A — canonical REVOKE pair for upsert_combo_v1.

REVOKE EXECUTE ON FUNCTION public.upsert_combo_v1(jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_combo_v1(jsonb, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
