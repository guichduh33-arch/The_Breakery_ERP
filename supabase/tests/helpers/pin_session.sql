-- Fixture PIN réservée au propriétaire de la transaction, jamais à un client.
-- À inclure après BEGIN ; le ROLLBACK supprime sessions et fonction temporaire.
CREATE OR REPLACE FUNCTION pg_temp.authenticate_pin(p_auth_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile uuid;
  v_session uuid := gen_random_uuid();
  v_permissions text[];
BEGIN
  SELECT id INTO STRICT v_profile FROM public.user_profiles
  WHERE auth_user_id = p_auth_user_id AND is_active AND deleted_at IS NULL;
  SELECT COALESCE(array_agg(code ORDER BY code), ARRAY[]::text[])
  INTO v_permissions FROM public.permissions
  WHERE public.has_permission(p_auth_user_id, code);
  INSERT INTO public.user_sessions(id, user_id, session_token_hash, device_type,
    permissions_snapshot, session_timeout_minutes, created_at, last_activity_at)
  VALUES (v_session, v_profile, 'pgtap-' || v_session, 'pos',
    v_permissions, 30, now(), now());
  PERFORM set_config('request.jwt.claim.sub', p_auth_user_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_auth_user_id, 'role', 'authenticated', 'session_id', v_session,
    'app_metadata', jsonb_build_object('provider', 'pin'),
    'exp', extract(epoch FROM now() + interval '1 hour'))::text, true);
  IF NOT public.request_has_active_pin_session_v1() THEN
    RAISE EXCEPTION 'invalid_pin_session_fixture';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.authenticate_pin(uuid) FROM PUBLIC, anon, authenticated;
