-- Fonctions internes réservées au serveur et au propriétaire utilisé par pg_cron.
REVOKE EXECUTE ON FUNCTION public.recompute_recipe_margins_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_recipe_margins_v1() TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.refresh_mv_pl_monthly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_mv_pl_monthly() TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.refresh_mv_sales_daily() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_mv_sales_daily() TO service_role, postgres;
REVOKE EXECUTE ON FUNCTION public.release_expired_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_reservations() TO service_role, postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
