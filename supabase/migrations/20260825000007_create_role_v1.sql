-- 20260825000007_create_role_v1.sql
-- ADR-032 — création (et clone) d'un rôle depuis l'écran, réservée au SUPER_ADMIN.
-- Un rôle créé ici naît is_system = false. Le clone copie les grants du rôle
-- source SAUF rbac.manage (réservée SUPER_ADMIN par ADR-031) — chaque grant
-- copié est tracé par trg_audit_role_permissions ; la création écrit en plus sa
-- propre ligne d'audit role.created.
--
-- Error map :
--   P0003 'unauthenticated' / 'forbidden' (rbac.manage) / 'super_admin_only'.
--   P0001 'invalid_code'    — hors ^[A-Za-z][A-Za-z0-9_]{2,29}$.
--   P0001 'role_exists'     — collision de code, insensible à la casse.
--   P0001 'invalid_name'    — nom hors 2..60.
--   P0001 'invalid_description' — description > 200.
--   P0001 'invalid_minutes' — timeout hors [5, 480].
--   P0002 'clone_source_not_found'.

CREATE OR REPLACE FUNCTION create_role_v1(
  p_code                    TEXT,
  p_name                    TEXT,
  p_description             TEXT DEFAULT NULL,
  p_session_timeout_minutes INT  DEFAULT NULL,
  p_clone_from              TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_caller_id      UUID;
  v_caller_role    TEXT;
  v_source_timeout INT;
  v_timeout        INT;
  v_copied         INT := 0;
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

  IF p_code IS NULL OR p_code !~ '^[A-Za-z][A-Za-z0-9_]{2,29}$' THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;
  -- Unicité insensible à la casse : « admin » n'est pas créable à côté d'« ADMIN ».
  IF EXISTS (SELECT 1 FROM roles WHERE upper(code) = upper(p_code)) THEN
    RAISE EXCEPTION 'role_exists' USING ERRCODE = 'P0001';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(p_name) > 60 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'P0001';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 200 THEN
    RAISE EXCEPTION 'invalid_description' USING ERRCODE = 'P0001';
  END IF;

  IF p_clone_from IS NOT NULL THEN
    SELECT session_timeout_minutes INTO v_source_timeout FROM roles WHERE code = p_clone_from;
    IF v_source_timeout IS NULL THEN
      RAISE EXCEPTION 'clone_source_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Timeout : valeur explicite > timeout du rôle source (clone) > défaut 30.
  v_timeout := COALESCE(p_session_timeout_minutes, v_source_timeout, 30);
  IF v_timeout < 5 OR v_timeout > 480 THEN
    RAISE EXCEPTION 'invalid_minutes' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO roles (code, name, description, is_system, session_timeout_minutes)
  VALUES (p_code, btrim(p_name), p_description, FALSE, v_timeout);

  IF p_clone_from IS NOT NULL THEN
    INSERT INTO role_permissions (role_code, permission_code, is_granted, granted_by)
    SELECT p_code, rp.permission_code, TRUE, v_caller_id
    FROM role_permissions rp
    WHERE rp.role_code = p_clone_from AND rp.is_granted
      AND rp.permission_code <> 'rbac.manage';
    GET DIAGNOSTICS v_copied = ROW_COUNT;
  END IF;

  -- entity_id NULL : la PK de roles est TEXT (déviation DEV-S19-1.B-01 conservée).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_caller_id, 'role.created', 'roles', NULL,
    jsonb_build_object(
      'role_code',          p_code,
      'name',               btrim(p_name),
      'cloned_from',        p_clone_from,
      'permissions_copied', v_copied,
      'session_timeout',    v_timeout
    )
  );

  RETURN p_code;
END;
$$;

COMMENT ON FUNCTION create_role_v1(TEXT, TEXT, TEXT, INT, TEXT) IS
  'ADR-032 — SUPER_ADMIN-only role creation, optional clone (grants copied minus rbac.manage), audited.';

REVOKE ALL ON FUNCTION create_role_v1(TEXT, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_role_v1(TEXT, TEXT, TEXT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION create_role_v1(TEXT, TEXT, TEXT, INT, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
