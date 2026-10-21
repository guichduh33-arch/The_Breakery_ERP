-- Corps issu de pg_get_functiondef sur dev V3 le 20 octobre 2026.
-- Deux blocs empêchent la résolution du helper privé pour les rôles publics.
CREATE FUNCTION public.enforce_pin_session_v2()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF NOT public.request_has_active_pin_session_v1() THEN
      RAISE EXCEPTION 'session_expired' USING ERRCODE = 'PT401';
    END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_pin_session_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_pin_session_v2() TO anon, authenticated, service_role, kiosk_display;
COMMENT ON FUNCTION public.enforce_pin_session_v2() IS 'anon-callable: pre-request neutre pour les parcours publics ; garde obligatoire du rôle authenticated';
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.enforce_pin_session_v1();
