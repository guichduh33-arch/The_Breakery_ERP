-- 20260825000003_create_set_role_permission_v1.sql
-- ADR-031 — mutation de la matrice rôle × permission, réservée au rôle SUPER_ADMIN.
-- Mutation en INSERT/DELETE strict (jamais UPDATE is_granted) : le trigger d'audit
-- trg_audit_role_permissions ne couvre que INSERT/DELETE.
--
-- Error map :
--   P0003 'unauthenticated'        — auth.uid() NULL.
--   P0003 'forbidden'              — l'appelant n'a pas rbac.manage.
--   P0003 'super_admin_only'       — l'appelant n'est pas SUPER_ADMIN (le vrai verrou :
--                                    ADMIN porte les mêmes permissions que SUPER_ADMIN).
--   P0001 'super_admin_row_locked' — la ligne SUPER_ADMIN est immuable (anti-lockout).
--   P0001 'granted_required'       — p_granted NULL.
--   P0002 'role_not_found' / 'permission_not_found'.

CREATE OR REPLACE FUNCTION set_role_permission_v1(
  p_role_code       TEXT,
  p_permission_code TEXT,
  p_granted         BOOLEAN
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_caller_id   UUID;
  v_caller_role TEXT;
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

  IF p_role_code = 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_row_locked' USING ERRCODE = 'P0001';
  END IF;

  IF p_granted IS NULL THEN
    RAISE EXCEPTION 'granted_required' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = p_role_code) THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM permissions WHERE code = p_permission_code) THEN
    RAISE EXCEPTION 'permission_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_granted THEN
    -- Ligne résiduelle is_granted=false : DELETE puis INSERT pour rester couvert
    -- par le trigger (un UPDATE serait invisible de l'audit).
    DELETE FROM role_permissions
    WHERE role_code = p_role_code AND permission_code = p_permission_code
      AND is_granted = FALSE;

    IF EXISTS (SELECT 1 FROM role_permissions
               WHERE role_code = p_role_code AND permission_code = p_permission_code) THEN
      RETURN FALSE; -- déjà accordée : no-op idempotent
    END IF;

    INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_by)
    VALUES (p_role_code, p_permission_code, TRUE, v_caller_id);
    RETURN TRUE;
  ELSE
    DELETE FROM role_permissions
    WHERE role_code = p_role_code AND permission_code = p_permission_code;
    RETURN FOUND; -- FALSE si rien à révoquer : no-op idempotent
  END IF;
END;
$$;

COMMENT ON FUNCTION set_role_permission_v1(TEXT, TEXT, BOOLEAN) IS
  'ADR-031 — SUPER_ADMIN-only grant/revoke of a role permission. INSERT/DELETE strict; audit via trg_audit_role_permissions.';

REVOKE ALL ON FUNCTION set_role_permission_v1(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION set_role_permission_v1(TEXT, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION set_role_permission_v1(TEXT, TEXT, BOOLEAN) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
