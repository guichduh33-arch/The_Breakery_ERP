-- S1-07 — désactiver un compte coupe ses droits immédiatement.
--
-- Deux manques, relevés sur les corps live de dev et de production le
-- 2026-11-12 (md5 de `has_permission` égal sur les deux bases) :
--
-- 1. `has_permission` retenait le profil sur `deleted_at IS NULL` seulement.
--    Un jeton encore valide d'un profil désactivé passait toutes les gardes.
-- 2. Aucune fonction ne désactivait un compte sans le supprimer : seul
--    `delete_user_v2` posait `is_active = false`, avec `deleted_at`. La
--    révocation des sessions n'existait qu'à la suppression et au changement
--    de rôle.
--
-- `has_permission` est remplacée EN PLACE : elle n'est pas versionnée, et les
-- politiques RLS comme les fonctions gatées la nomment telle quelle. Le corps
-- part du live ; seule la ligne de sélection du profil change.
--
-- `set_user_active_v1` reprend les gardes de `update_user_role_v2` (corps
-- live) : permission `users.update`, appelant actif, motif, cible
-- SUPER_ADMIN réservée au SUPER_ADMIN, dernier administrateur actif protégé.
-- Elle refuse en plus l'auto-désactivation. À la désactivation, les sessions
-- applicatives ouvertes sont closes avec le motif `account_deactivated`, puis
-- le helper de révocation retire les sessions d'authentification.

CREATE OR REPLACE FUNCTION public.has_permission(p_uid uuid, p_perm text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_profile_id UUID;
  v_role_code  TEXT;
BEGIN
  IF p_uid IS NULL OR p_perm IS NULL THEN
    RETURN FALSE;
  END IF;
  SELECT id, role_code INTO v_profile_id, v_role_code
    FROM user_profiles
   WHERE auth_user_id = p_uid AND deleted_at IS NULL AND is_active IS TRUE
   LIMIT 1;
  IF v_profile_id IS NULL OR v_role_code IS NULL THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM user_permission_overrides
     WHERE user_profile_id = v_profile_id
       AND permission_code = p_perm
       AND is_granted = FALSE
       AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM role_permissions
     WHERE role_code = v_role_code
       AND permission_code = p_perm
       AND is_granted = TRUE
  ) THEN
    RETURN TRUE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM user_permission_overrides
     WHERE user_profile_id = v_profile_id
       AND permission_code = p_perm
       AND is_granted = TRUE
       AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END $function$;

CREATE FUNCTION public.set_user_active_v1(
  p_user_id   uuid,
  p_is_active boolean,
  p_reason    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_caller_uid  UUID := auth.uid();
  v_caller_prof UUID;
  v_caller_role TEXT;
  v_role_code   TEXT;
  v_was_active  BOOLEAN;
  v_app_ended   INTEGER := 0;
  v_revoked     INTEGER := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('user_identity_mutation', 0));
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'set_user_active_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'set_user_active_v1: missing permission users.update' USING ERRCODE = '42501';
  END IF;

  SELECT id, role_code INTO v_caller_prof, v_caller_role FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL AND is_active = true
    LIMIT 1 FOR SHARE;
  IF v_caller_prof IS NULL THEN
    RAISE EXCEPTION 'active_profile_required' USING ERRCODE = '42501';
  END IF;

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'set_user_active_v1: p_is_active is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'set_user_active_v1: reason must be at least 3 chars' USING ERRCODE = '22023';
  END IF;

  SELECT role_code, is_active INTO v_role_code, v_was_active
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL
     FOR UPDATE;
  IF v_role_code IS NULL THEN
    RAISE EXCEPTION 'set_user_active_v1: user not found or deleted' USING ERRCODE = 'P0002';
  END IF;

  IF v_role_code = 'SUPER_ADMIN' AND v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = v_caller_prof AND NOT p_is_active THEN
    RAISE EXCEPTION 'self_deactivation_forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_was_active IS NOT DISTINCT FROM p_is_active THEN
    RETURN jsonb_build_object('is_active', p_is_active, 'revoked_session_count', 0, 'noop', true);
  END IF;

  -- Dernier administrateur ACTIF : même garde que la suppression et le
  -- changement de rôle. Un administrateur inactif ne protège personne.
  IF NOT p_is_active
     AND v_role_code IN ('ADMIN','SUPER_ADMIN')
     AND (
       SELECT count(*) FROM user_profiles
        WHERE role_code IN ('ADMIN','SUPER_ADMIN')
          AND deleted_at IS NULL
          AND is_active = true
          AND id <> p_user_id
     ) = 0
  THEN
    RAISE EXCEPTION 'LAST_ADMIN_PROTECTED: cannot deactivate the last remaining admin'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE user_profiles
     SET is_active = p_is_active, updated_at = now()
   WHERE id = p_user_id;

  IF NOT p_is_active THEN
    WITH u AS (
      UPDATE user_sessions
         SET ended_at = now(), end_reason = COALESCE(end_reason, 'account_deactivated')
       WHERE user_id = p_user_id AND ended_at IS NULL
       RETURNING 1
    )
    SELECT count(*)::INTEGER INTO v_app_ended FROM u;
    v_revoked := v_app_ended + _revoke_user_sessions_v1(p_user_id);
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_prof,
    CASE WHEN p_is_active THEN 'user.reactivate' ELSE 'user.deactivate' END,
    'user_profile', p_user_id,
    jsonb_build_object(
      'role_code', v_role_code,
      'reason',    trim(p_reason),
      'revoked_session_count', v_revoked
    )
  );

  RETURN jsonb_build_object('is_active', p_is_active, 'revoked_session_count', v_revoked);
END $function$;

REVOKE ALL ON FUNCTION public.set_user_active_v1(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_active_v1(uuid, boolean, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
