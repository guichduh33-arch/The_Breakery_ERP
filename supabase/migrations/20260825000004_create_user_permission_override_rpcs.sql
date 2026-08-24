-- 20260825000004_create_user_permission_override_rpcs.sql
-- ADR-031 — overrides de permission par utilisateur, réservés au rôle SUPER_ADMIN.
-- Aucun trigger d'audit sur user_permission_overrides : les deux RPC écrivent
-- audit_logs manuellement (actor_id = user_profiles.id de l'appelant).
-- L'upsert ON CONFLICT DO UPDATE est licite ici (pas de trigger à contourner).
--
-- Error map (commune) :
--   P0003 'unauthenticated' / 'forbidden' / 'super_admin_only' — voir set_role_permission_v1.
--   P0001 'super_admin_target_locked' — aucun override ne peut cibler un profil SUPER_ADMIN
--                                       (un DENY y verrouillerait les gates serveur : lockout).
--   P0002 'profile_not_found' / 'permission_not_found'.
--   P0001 'granted_required' / 'invalid_reason' (3-200) / 'invalid_expiry' (passé).

CREATE OR REPLACE FUNCTION set_user_permission_override_v1(
  p_user_profile_id UUID,
  p_permission_code TEXT,
  p_granted         BOOLEAN,
  p_reason          TEXT,
  p_expires_at      TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_target_role TEXT;
  v_before      JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, role_code INTO v_caller_id, v_caller_role
  FROM user_profiles
  WHERE auth_user_id = v_uid AND deleted_at IS NULL
  LIMIT 1;

  IF NOT has_permission(v_uid, 'rbac.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = 'P0003';
  END IF;

  SELECT role_code INTO v_target_role
  FROM user_profiles
  WHERE id = p_user_profile_id AND deleted_at IS NULL;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_target_role = 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_target_locked' USING ERRCODE = 'P0001';
  END IF;

  IF p_granted IS NULL THEN
    RAISE EXCEPTION 'granted_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR length(p_reason) < 3 OR length(p_reason) > 200 THEN
    RAISE EXCEPTION 'invalid_reason' USING ERRCODE = 'P0001';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_expiry' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = p_permission_code) THEN
    RAISE EXCEPTION 'permission_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- État avant, pour le diff d'audit (NULL si création).
  SELECT jsonb_build_object('is_granted', o.is_granted, 'reason', o.reason,
                            'expires_at', o.expires_at)
  INTO v_before
  FROM user_permission_overrides o
  WHERE o.user_profile_id = p_user_profile_id AND o.permission_code = p_permission_code;

  INSERT INTO user_permission_overrides
    (user_profile_id, permission_code, is_granted, reason, granted_by, expires_at)
  VALUES
    (p_user_profile_id, p_permission_code, p_granted, p_reason, v_caller_id, p_expires_at)
  ON CONFLICT (user_profile_id, permission_code) DO UPDATE
    SET is_granted = EXCLUDED.is_granted,
        reason     = EXCLUDED.reason,
        granted_by = EXCLUDED.granted_by,
        granted_at = now(),
        expires_at = EXCLUDED.expires_at;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_caller_id,
    'user.permission_override_set',
    'user_profiles',
    p_user_profile_id,
    jsonb_build_object(
      'permission_code', p_permission_code,
      'is_granted',      p_granted,
      'reason',          p_reason,
      'expires_at',      p_expires_at,
      'before',          v_before
    )
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION set_user_permission_override_v1(UUID, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) IS
  'ADR-031 — SUPER_ADMIN-only upsert of a per-user permission override, with manual audit log.';

CREATE OR REPLACE FUNCTION delete_user_permission_override_v1(
  p_user_profile_id UUID,
  p_permission_code TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_before      JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, role_code INTO v_caller_id, v_caller_role
  FROM user_profiles
  WHERE auth_user_id = v_uid AND deleted_at IS NULL
  LIMIT 1;

  IF NOT has_permission(v_uid, 'rbac.manage') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = 'P0003';
  END IF;

  SELECT jsonb_build_object('is_granted', o.is_granted, 'reason', o.reason,
                            'expires_at', o.expires_at)
  INTO v_before
  FROM user_permission_overrides o
  WHERE o.user_profile_id = p_user_profile_id AND o.permission_code = p_permission_code;

  IF v_before IS NULL THEN
    RETURN FALSE; -- rien à supprimer : no-op idempotent
  END IF;

  DELETE FROM user_permission_overrides
  WHERE user_profile_id = p_user_profile_id AND permission_code = p_permission_code;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_caller_id,
    'user.permission_override_removed',
    'user_profiles',
    p_user_profile_id,
    jsonb_build_object(
      'permission_code', p_permission_code,
      'before',          v_before
    )
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION delete_user_permission_override_v1(UUID, TEXT) IS
  'ADR-031 — SUPER_ADMIN-only removal of a per-user permission override, with manual audit log.';

REVOKE ALL ON FUNCTION set_user_permission_override_v1(UUID, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_user_permission_override_v1(UUID, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) FROM anon;
GRANT EXECUTE ON FUNCTION set_user_permission_override_v1(UUID, TEXT, BOOLEAN, TEXT, TIMESTAMPTZ) TO authenticated;

REVOKE ALL ON FUNCTION delete_user_permission_override_v1(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_user_permission_override_v1(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION delete_user_permission_override_v1(UUID, TEXT) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
