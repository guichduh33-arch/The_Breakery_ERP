-- Contrat commun : changement personnel réauthentifié ou reset administratif.
-- Le helper n'est exposé qu'au service EF ; l'identité vient de sa session validée.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION public.change_user_pin_v1(
  p_actor_id uuid, p_user_id uuid, p_new_pin text, p_current_pin text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
DECLARE
  v_actor user_profiles%ROWTYPE;
  v_target user_profiles%ROWTYPE;
  v_self boolean;
BEGIN
  -- Ordre identique aux autres mutations d'identité, puis verrou des profils.
  PERFORM pg_advisory_xact_lock(hashtextextended('user_identity_mutation', 0));
  SELECT * INTO v_actor FROM user_profiles
    WHERE id = p_actor_id AND deleted_at IS NULL AND is_active = true FOR UPDATE;
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'active_profile_required');
  END IF;
  v_self := v_actor.id = p_user_id;
  IF NOT v_self AND NOT has_permission(v_actor.auth_user_id, 'users.update') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'permission_denied');
  END IF;
  SELECT * INTO v_target FROM user_profiles
    WHERE id = p_user_id AND deleted_at IS NULL FOR UPDATE;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'user_not_found');
  END IF;
  IF v_target.role_code = 'SUPER_ADMIN' AND v_actor.role_code IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'super_admin_only');
  END IF;
  IF p_new_pin IS NULL OR p_new_pin !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_new_pin_format');
  END IF;
  IF v_self THEN
    IF p_current_pin IS NULL OR p_current_pin = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'current_pin_required');
    END IF;
    IF v_target.locked_until > now() THEN
      RETURN jsonb_build_object('ok', false, 'error', 'account_locked');
    END IF;
    -- Retourner un refus, ne pas lever : une exception annulerait le compteur.
    IF public._verify_pin_with_lockout(p_user_id, p_current_pin) IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_current_pin');
    END IF;
  END IF;
  UPDATE user_profiles SET pin_hash = hash_pin(p_new_pin),
    failed_login_attempts = 0, locked_until = NULL, updated_at = now()
    WHERE id = p_user_id;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_actor_id, CASE WHEN v_self THEN 'pin.change_self' ELSE 'pin.change_admin' END,
      'user_profiles', p_user_id, jsonb_build_object('is_self', v_self));
  RETURN jsonb_build_object('ok', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.change_user_pin_v1(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_user_pin_v1(uuid, uuid, text, text) TO service_role;

-- Le reset public ne permet jamais de contourner le PIN courant personnel.
-- Corps de reset_user_pin relevé live le 2026-09-09, contrat admin uniquement.
CREATE FUNCTION public.reset_user_pin_v2(p_user_id uuid, p_new_pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_actor_id uuid;
  v_result jsonb;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'caller_not_authenticated' USING ERRCODE = '28000';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('user_identity_mutation', 0));
  SELECT id INTO v_actor_id FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL AND is_active = true FOR UPDATE;
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'active_profile_required' USING ERRCODE = '42501';
  END IF;
  IF v_actor_id = p_user_id THEN
    RAISE EXCEPTION 'self_reset_forbidden_use_pin_change' USING ERRCODE = '42501';
  END IF;
  v_result := public.change_user_pin_v1(v_actor_id, p_user_id, p_new_pin, NULL);
  IF (v_result->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '%', v_result->>'error' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.reset_user_pin_v2(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_user_pin_v2(uuid, text) TO authenticated, service_role;
DROP FUNCTION public.reset_user_pin_v1(uuid, text);
