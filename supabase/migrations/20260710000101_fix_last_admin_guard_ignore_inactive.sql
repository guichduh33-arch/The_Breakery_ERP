-- 20260710000101_fix_last_admin_guard_ignore_inactive.sql
-- Session 59 / Task 1 — Fix F-1 (P0, S58) : la garde LAST_ADMIN_PROTECTED de
-- `delete_user_v1` (et le même pattern sur le downgrade dans
-- `update_user_role_v1`) compte les admins restants avec `deleted_at IS NULL`
-- SANS filtrer `is_active`. Le seed SYS-CRON (SUPER_ADMIN inactif) est donc
-- compté comme un admin "restant" : un opérateur peut supprimer/downgrader
-- le DERNIER ADMIN RÉEL ACTIF tout en étant protégé par un compte qui ne peut
-- jamais se connecter (is_active = false) → lockout administratif silencieux.
--
-- Fix : ajouter `AND is_active = true` au sous-compte des admins restants
-- dans les DEUX gardes. Correction de bug pure — signature ET comportement
-- inchangés hors la fermeture du bug (pas de bump _vN, cf. règle
-- "in-place fix" du plan S59). Le reste des deux fonctions (permission
-- gates, audit rows, revocation de sessions) est préservé à l'identique.
--
-- Corps LIVE vérifié via pg_get_functiondef avant application (DEV-S57-02) :
-- identique au fichier source 20260517000200, aucun drift sur les gardes.

CREATE OR REPLACE FUNCTION public.update_user_role_v1(
  p_user_id       UUID,
  p_new_role_code TEXT,
  p_reason        TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_caller_uid       UUID := auth.uid();
  v_caller_prof      UUID;
  v_old_role         TEXT;
  v_revoked          INTEGER;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'update_user_role_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'update_user_role_v1: missing permission users.update' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_prof FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'update_user_role_v1: reason must be at least 3 chars' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = p_new_role_code) THEN
    RAISE EXCEPTION 'update_user_role_v1: unknown role_code %', p_new_role_code USING ERRCODE = '23503';
  END IF;

  SELECT role_code INTO v_old_role
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL
     FOR UPDATE;

  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'update_user_role_v1: user not found or deleted' USING ERRCODE = 'P0002';
  END IF;

  IF v_old_role = p_new_role_code THEN
    RETURN jsonb_build_object(
      'old_role', v_old_role,
      'new_role', p_new_role_code,
      'revoked_session_count', 0,
      'noop', true
    );
  END IF;

  -- Last-admin guard : refuse downgrading the last remaining ACTIVE admin.
  -- Fix S59/F-1 : `AND is_active = true` added — an inactive admin (e.g. the
  -- SYS-CRON seed) must not be able to "shield" the real last active admin.
  IF v_old_role IN ('ADMIN','SUPER_ADMIN')
     AND p_new_role_code NOT IN ('ADMIN','SUPER_ADMIN')
     AND (
       SELECT count(*) FROM user_profiles
        WHERE role_code IN ('ADMIN','SUPER_ADMIN')
          AND deleted_at IS NULL
          AND is_active = true
          AND id <> p_user_id
     ) = 0
  THEN
    RAISE EXCEPTION 'LAST_ADMIN_PROTECTED: cannot downgrade the last remaining admin'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE user_profiles
     SET role_code = p_new_role_code, updated_at = now()
   WHERE id = p_user_id;

  v_revoked := _revoke_user_sessions_v1(p_user_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_prof, 'user.role_change', 'user_role', p_user_id,
    jsonb_build_object(
      'old_role', v_old_role,
      'new_role', p_new_role_code,
      'reason',   trim(p_reason),
      'revoked_session_count', v_revoked
    )
  );

  RETURN jsonb_build_object(
    'old_role', v_old_role,
    'new_role', p_new_role_code,
    'revoked_session_count', v_revoked
  );
END $function$;

COMMENT ON FUNCTION public.update_user_role_v1(UUID,TEXT,TEXT) IS
  'Phase 5.D : change a user role. Revokes active sessions. Audits change. Gated users.update. Last-admin guard ignores inactive admins (S59 fix F-1).';

CREATE OR REPLACE FUNCTION public.delete_user_v1(
  p_user_id UUID,
  p_reason  TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_caller_uid   UUID := auth.uid();
  v_caller_prof  UUID;
  v_role_code    TEXT;
  v_deleted_at   TIMESTAMPTZ;
  v_revoked      INTEGER;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'delete_user_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'delete_user_v1: missing permission users.update' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_prof FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'delete_user_v1: reason must be at least 3 chars' USING ERRCODE = '22023';
  END IF;

  SELECT role_code INTO v_role_code
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL
     FOR UPDATE;

  IF v_role_code IS NULL THEN
    RAISE EXCEPTION 'delete_user_v1: user not found or already deleted'
      USING ERRCODE = 'P0002';
  END IF;

  -- Last-admin guard : refuse deleting the last remaining ACTIVE admin.
  -- Fix S59/F-1 : `AND is_active = true` added — an inactive admin (e.g. the
  -- SYS-CRON seed) must not be able to "shield" the real last active admin.
  IF v_role_code IN ('ADMIN','SUPER_ADMIN')
     AND (
       SELECT count(*) FROM user_profiles
        WHERE role_code IN ('ADMIN','SUPER_ADMIN')
          AND deleted_at IS NULL
          AND is_active = true
          AND id <> p_user_id
     ) = 0
  THEN
    RAISE EXCEPTION 'LAST_ADMIN_PROTECTED: cannot delete the last remaining admin'
      USING ERRCODE = 'P0001';
  END IF;

  v_deleted_at := now();
  UPDATE user_profiles
     SET deleted_at = v_deleted_at,
         is_active  = false,
         updated_at = v_deleted_at
   WHERE id = p_user_id;

  v_revoked := _revoke_user_sessions_v1(p_user_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_prof, 'user.delete', 'user_profile', p_user_id,
    jsonb_build_object(
      'role_code', v_role_code,
      'reason',    trim(p_reason),
      'revoked_session_count', v_revoked
    )
  );

  RETURN jsonb_build_object(
    'deleted_at',            v_deleted_at,
    'revoked_session_count', v_revoked
  );
END $function$;

COMMENT ON FUNCTION public.delete_user_v1(UUID,TEXT) IS
  'Phase 5.D : soft-delete a user. Refuses on last active admin. Revokes sessions. Audits. Gated users.update. Last-admin guard ignores inactive admins (S59 fix F-1).';
