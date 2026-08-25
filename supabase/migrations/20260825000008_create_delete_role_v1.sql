-- 20260825000008_create_delete_role_v1.sql
-- ADR-032 — suppression d'un rôle créé à la main, réservée au SUPER_ADMIN.
-- Les rôles système (is_system) sont intouchables. La suppression est refusée
-- tant qu'au moins un user_profiles porte le rôle (la FK RESTRICT le garantit
-- déjà ; la garde rend l'erreur lisible et compte les porteurs, soft-deleted
-- inclus puisque la FK les retient aussi). La cascade role_permissions est
-- tracée ligne à ligne par trg_audit_role_permissions ; la suppression écrit en
-- plus sa propre ligne d'audit role.deleted.
--
-- Error map :
--   P0003 'unauthenticated' / 'forbidden' (rbac.manage) / 'super_admin_only'.
--   P0002 'role_not_found'.
--   P0001 'system_role_locked' — rôle is_system.
--   P0001 'role_in_use'        — des profils portent encore le rôle (DETAIL = compte).

CREATE OR REPLACE FUNCTION delete_role_v1(
  p_code TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_name        TEXT;
  v_is_system   BOOLEAN;
  v_users       INT;
  v_grants      INT;
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

  SELECT name, is_system INTO v_name, v_is_system FROM roles WHERE code = p_code;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_is_system THEN
    RAISE EXCEPTION 'system_role_locked' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_users FROM user_profiles WHERE role_code = p_code;
  IF v_users > 0 THEN
    RAISE EXCEPTION 'role_in_use' USING ERRCODE = 'P0001',
      DETAIL = format('%s user profile(s) still hold this role', v_users);
  END IF;

  SELECT COUNT(*) INTO v_grants FROM role_permissions WHERE role_code = p_code;

  DELETE FROM roles WHERE code = p_code;

  -- entity_id NULL : la PK de roles est TEXT (déviation DEV-S19-1.B-01 conservée).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_caller_id, 'role.deleted', 'roles', NULL,
    jsonb_build_object(
      'role_code',      p_code,
      'name',           v_name,
      'grants_removed', v_grants
    )
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION delete_role_v1(TEXT) IS
  'ADR-032 — SUPER_ADMIN-only deletion of a non-system, unassigned role. Cascade grants audited by trigger.';

REVOKE ALL ON FUNCTION delete_role_v1(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION delete_role_v1(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION delete_role_v1(TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
