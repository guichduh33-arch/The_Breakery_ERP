-- Le dispatcher serveur est le seul appelant autorisé à prélever les notifications.
REVOKE EXECUTE ON FUNCTION public.pick_notifications_batch_v2(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pick_notifications_batch_v2(integer) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
