-- Vérification PIN sérialisée sur le profil ; le rôle service reste le seul appelant direct.
CREATE OR REPLACE FUNCTION public._verify_pin_with_lockout(p_user_id uuid, p_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hash    TEXT;
  v_locked  TIMESTAMPTZ;
BEGIN
  SELECT pin_hash, locked_until INTO v_hash, v_locked
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL
   FOR UPDATE;

  IF v_hash IS NULL THEN
    RETURN false;
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RAISE EXCEPTION 'account_locked' USING ERRCODE = 'P0004';
  END IF;

  IF v_hash = crypt(p_pin, v_hash) THEN
    UPDATE user_profiles SET failed_login_attempts = 0, locked_until = NULL WHERE id = p_user_id;
    RETURN true;
  END IF;

  PERFORM record_pin_failure_v1(p_user_id, 'rpc');
  RETURN false;
END;
$function$;

-- Le login a sa politique configurable ; les validations métier gardent leur 5/15.
CREATE FUNCTION public.verify_login_pin_v1(p_user_id uuid, p_pin text, p_ip text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_max_failed integer := 5;
  v_lockout_min integer := 15;
  v_attempts integer;
BEGIN
  IF p_pin IS NULL OR p_pin !~ '^\d{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin_format');
  END IF;
  SELECT * INTO v_profile FROM public.user_profiles
  WHERE id = p_user_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;
  IF NOT v_profile.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_inactive');
  END IF;
  IF v_profile.locked_until IS NOT NULL AND v_profile.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_locked',
      'minutes_left', ceil(extract(epoch FROM v_profile.locked_until - now()) / 60)::integer);
  END IF;

  SELECT COALESCE(pin_max_failed, 5), COALESCE(pin_lockout_minutes, 15)
  INTO v_max_failed, v_lockout_min FROM public.business_config WHERE id = 1;
  IF NOT FOUND THEN
    v_max_failed := 5;
    v_lockout_min := 15;
  END IF;

  IF v_profile.pin_hash IS NOT NULL AND v_profile.pin_hash = crypt(p_pin, v_profile.pin_hash) THEN
    UPDATE public.user_profiles SET failed_login_attempts = 0, locked_until = NULL
    WHERE id = p_user_id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_attempts := COALESCE(v_profile.failed_login_attempts, 0) + 1;
  UPDATE public.user_profiles SET failed_login_attempts = v_attempts,
    locked_until = CASE WHEN v_attempts >= v_max_failed
      THEN now() + make_interval(mins => v_lockout_min) ELSE locked_until END
  WHERE id = p_user_id;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_user_id, 'login.failed', 'user_profiles', p_user_id,
    jsonb_build_object('attempts', v_attempts, 'ip', p_ip));
  RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin',
    'attempts_remaining', greatest(0, v_max_failed - v_attempts));
END;
$$;
REVOKE ALL ON FUNCTION public.verify_login_pin_v1(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_login_pin_v1(uuid,text,text) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
