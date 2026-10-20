-- Préparation sans activation globale : déployer les émetteurs avant le durcissement.
CREATE FUNCTION public.is_pin_session_active_v1(p_session_id uuid, p_auth_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_sessions s
    JOIN public.user_profiles p ON p.id = s.user_id
    WHERE s.id = p_session_id AND p.auth_user_id = p_auth_user_id
      AND p.is_active IS TRUE AND p.deleted_at IS NULL
      AND s.ended_at IS NULL
      AND s.permissions_snapshot IS NOT NULL
      AND COALESCE(array_ndims(s.permissions_snapshot), 1) = 1
      AND NOT EXISTS (SELECT 1 FROM unnest(s.permissions_snapshot) permission WHERE permission IS NULL)
      AND s.session_timeout_minutes BETWEEN 5 AND 480
      AND s.created_at > now() - interval '24 hours'
      AND s.created_at <= now() AND s.last_activity_at <= now()
      AND s.last_activity_at > now() - make_interval(mins => s.session_timeout_minutes)
  );
$$;

CREATE FUNCTION public.request_has_active_pin_session_v1()
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  IF v_claims->>'role' IS DISTINCT FROM 'authenticated'
     OR v_claims->'app_metadata'->>'provider' IS DISTINCT FROM 'pin'
     OR COALESCE(v_claims->>'sub', '') !~ v_uuid
     OR COALESCE(v_claims->>'session_id', '') !~ v_uuid
     OR jsonb_typeof(v_claims->'exp') IS DISTINCT FROM 'number' THEN
    RETURN false;
  END IF;
  IF (v_claims->>'exp')::numeric <= extract(epoch FROM now()) THEN RETURN false; END IF;
  RETURN public.is_pin_session_active_v1((v_claims->>'session_id')::uuid, (v_claims->>'sub')::uuid);
END;
$$;

CREATE FUNCTION public.enforce_pin_session_v1()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Les rôles appareil/serveur et les lectures anon gardent leurs propres gates.
  IF current_user = 'authenticated' AND NOT public.request_has_active_pin_session_v1() THEN
    RAISE EXCEPTION 'session_expired' USING ERRCODE = 'PT401';
  END IF;
END;
$$;

CREATE FUNCTION public.logout_user_session_v1(p_session_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_session public.user_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.user_sessions
  WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_session.ended_at IS NOT NULL THEN RETURN v_session.end_reason = 'logout'; END IF;
  UPDATE public.user_sessions SET ended_at = now(), end_reason = 'logout' WHERE id = p_session_id;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id)
  VALUES (p_user_id, 'logout', 'user_sessions', p_session_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_pin_session_active_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.logout_user_session_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_has_active_pin_session_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_pin_session_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pin_session_active_v1(uuid, uuid), public.logout_user_session_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_has_active_pin_session_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enforce_pin_session_v1() TO anon, authenticated, service_role, kiosk_display;
COMMENT ON FUNCTION public.enforce_pin_session_v1() IS 'anon-callable: pre-request neutre pour les parcours publics ; garde obligatoire du rôle authenticated';
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
