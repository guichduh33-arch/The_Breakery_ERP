-- 20260623000012_revoke_pair_b2b_settings_rpcs.sql
-- Session 39 \ Wave A \ Task A3 (BO-15) — REVOKE pair canonique S25 pour les RPCs b2b_settings.
-- Pattern S25 : 3 lignes obligatoires par fonction + GRANT authenticated.

REVOKE ALL ON FUNCTION public.get_b2b_settings_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_b2b_settings_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_b2b_settings_v1() TO authenticated;

REVOKE ALL ON FUNCTION public.update_b2b_settings_v1(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_b2b_settings_v1(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_b2b_settings_v1(JSONB) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
