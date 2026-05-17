-- 20260523000021_create_update_role_session_timeout_v1_rpc.sql
-- Session 19 / Phase 1.B — Update RPC for per-role session timeout (Thread B).
--
-- Gated by has_permission('settings.update') AND caller role IN
-- ('SUPER_ADMIN','ADMIN'). Writes audit_logs row on every successful change (D9).
--
-- Error code map :
--   P0003 'unauthenticated' — auth.uid() is NULL.
--   P0003 'forbidden'       — caller lacks settings.update.
--   P0003 'admin_only'      — caller has settings.update but is not ADMIN/SUPER_ADMIN.
--   P0001 'invalid_minutes' — p_minutes outside [5, 480] (CHECK also catches).
--   P0002 'role_not_found'  — p_role_code does not exist in roles.code.
--
-- Note: audit_logs.entity_id is UUID NOT NULL'able but the roles PK is `code`
-- (TEXT), so entity_id is set to NULL and the role code is carried in payload.
-- Deviation DEV-S19-1.B-01 (informational).

CREATE OR REPLACE FUNCTION update_role_session_timeout_v1(
  p_role_code TEXT,
  p_minutes   INT
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_caller_role  TEXT;
  v_before       INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0003';
  END IF;

  -- Permission gate.
  IF NOT has_permission(v_uid, 'settings.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  -- Role gate. user_profiles.role_code is the canonical source of caller role.
  SELECT role_code INTO v_caller_role
  FROM user_profiles
  WHERE auth_user_id = v_uid
  LIMIT 1;

  IF v_caller_role NOT IN ('SUPER_ADMIN', 'ADMIN') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = 'P0003';
  END IF;

  -- Bounds (the CHECK also catches this, but we want a friendlier error).
  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 480 THEN
    RAISE EXCEPTION 'invalid_minutes' USING ERRCODE = 'P0001';
  END IF;

  -- Capture before-value (also asserts the role exists).
  SELECT session_timeout_minutes INTO v_before FROM roles WHERE code = p_role_code;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Mutate.
  UPDATE roles SET session_timeout_minutes = p_minutes WHERE code = p_role_code;

  -- Audit. entity_id stays NULL (roles PK is TEXT, audit_logs.entity_id is UUID).
  -- Role code is carried in payload.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_uid,
    'role.session_timeout_changed',
    'roles',
    NULL,
    jsonb_build_object(
      'role_code', p_role_code,
      'before',    v_before,
      'after',     p_minutes
    )
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION update_role_session_timeout_v1(TEXT, INT) IS
  'Session 19 — admin-only mutate of roles.session_timeout_minutes with audit log.';

REVOKE ALL ON FUNCTION update_role_session_timeout_v1(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_role_session_timeout_v1(TEXT, INT) TO authenticated;
