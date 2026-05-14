-- 20260517000200_create_user_rpcs.sql
-- Session 13 / Phase 5.D — RBAC UI : user-management RPCs.
--
-- Creates five SECURITY DEFINER RPCs :
--   - create_user_v1          : INSERT auth.users + user_profiles + audit.
--   - update_user_role_v1     : change role_code + revoke active sessions + audit.
--   - delete_user_v1          : soft-delete + last-admin guard + audit + revoke.
--   - update_user_profile_v1  : self-or-admin name/employee_code edit + audit.
--   - reset_user_pin_v1       : self-or-admin pin change + audit.
--
-- Permission gates :
--   - create_user_v1 / delete_user_v1 / update_user_role_v1 → 'users.create' /
--     'users.update' (via has_permission()).
--   - update_user_profile_v1 / reset_user_pin_v1 : caller is target OR has
--     'users.update'.
--
-- Last-admin protection :
--   - delete_user_v1 RAISEs SQLSTATE P0001 message 'LAST_ADMIN_PROTECTED'
--     if target is the last remaining non-deleted ADMIN or SUPER_ADMIN.
--
-- Session revocation on role change :
--   - DELETE auth.sessions WHERE user_id = target.auth_user_id.
--   - UPDATE user_sessions SET ended_at = now(), end_reason = 'role_changed'
--     WHERE user_id = p_user_id AND ended_at IS NULL.
--
-- Auth strategy : SECURITY DEFINER runs as the owning role (postgres in
-- staging), which has implicit privileges on auth.users / auth.sessions.
-- No gotrue admin API call needed — see Phase 5.D sub-plan §2 D-W5-5D-02 / 03.
--
-- has_permission() is NOT re-CREATEd here (locked since Phase 1.B / 000030).
-- New permissions for this phase are already seeded in 000030 (users.create,
-- users.read, users.update, users.view_audit, rbac.read, rbac.update).

BEGIN;

-- ===========================================================================
-- Helper : revoke active sessions for a profile + return revoked count.
-- ===========================================================================

CREATE OR REPLACE FUNCTION _revoke_user_sessions_v1(p_profile_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_auth_user_id UUID;
  v_auth_count   INTEGER := 0;
  v_app_count    INTEGER := 0;
BEGIN
  SELECT auth_user_id INTO v_auth_user_id
    FROM user_profiles WHERE id = p_profile_id LIMIT 1;

  IF v_auth_user_id IS NOT NULL THEN
    WITH d AS (
      DELETE FROM auth.sessions WHERE user_id = v_auth_user_id RETURNING 1
    )
    SELECT count(*)::INTEGER INTO v_auth_count FROM d;
  END IF;

  WITH u AS (
    UPDATE user_sessions
       SET ended_at = now(), end_reason = COALESCE(end_reason, 'role_changed')
     WHERE user_id = p_profile_id AND ended_at IS NULL
     RETURNING 1
  )
  SELECT count(*)::INTEGER INTO v_app_count FROM u;

  RETURN COALESCE(v_auth_count, 0) + COALESCE(v_app_count, 0);
END $$;

COMMENT ON FUNCTION _revoke_user_sessions_v1(UUID) IS
  'Phase 5.D : revoke all active GoTrue + app sessions for a user_profiles.id. Returns total count.';

-- ===========================================================================
-- 1. create_user_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION create_user_v1(
  p_employee_code TEXT,
  p_full_name     TEXT,
  p_role_code     TEXT,
  p_pin           TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_uid    UUID := auth.uid();
  v_caller_prof   UUID;
  v_new_auth_id   UUID := gen_random_uuid();
  v_new_profile   UUID;
  v_email         TEXT;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'create_user_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'users.create') THEN
    RAISE EXCEPTION 'create_user_v1: missing permission users.create' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_caller_prof FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  -- Input validation
  IF p_employee_code IS NULL OR length(trim(p_employee_code)) < 3 THEN
    RAISE EXCEPTION 'create_user_v1: employee_code must be at least 3 chars' USING ERRCODE = '22023';
  END IF;
  IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
    RAISE EXCEPTION 'create_user_v1: full_name must be at least 2 chars' USING ERRCODE = '22023';
  END IF;
  IF p_pin IS NULL OR length(p_pin) NOT BETWEEN 4 AND 8 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'create_user_v1: pin must be 4-8 digits' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = p_role_code) THEN
    RAISE EXCEPTION 'create_user_v1: unknown role_code %', p_role_code USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM user_profiles WHERE employee_code = trim(p_employee_code)) THEN
    RAISE EXCEPTION 'create_user_v1: employee_code % already exists', p_employee_code USING ERRCODE = '23505';
  END IF;

  v_email := 'staff-' || lower(trim(p_employee_code)) || '@thebreakery.local';

  -- 1. INSERT auth.users (mirror seed.sql pattern).
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_user_meta_data, raw_app_meta_data,
    confirmation_token, recovery_token,
    email_change_token_new, email_change,
    created_at, updated_at
  ) VALUES (
    v_new_auth_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    v_email,
    crypt('disabled-password-' || gen_random_uuid(), gen_salt('bf')),
    now(), '{"provider":"pin"}'::jsonb, '{"provider":"pin","providers":["pin"]}'::jsonb,
    '', '',
    '', '',
    now(), now()
  );

  -- 2. INSERT user_profiles
  INSERT INTO user_profiles (
    auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES (
    v_new_auth_id, trim(p_employee_code), trim(p_full_name),
    hash_pin(p_pin), p_role_code, true
  )
  RETURNING id INTO v_new_profile;

  -- 3. Audit row
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_prof, 'user.create', 'user_profile', v_new_profile,
    jsonb_build_object(
      'employee_code', trim(p_employee_code),
      'full_name',     trim(p_full_name),
      'role_code',     p_role_code
    )
  );

  RETURN v_new_profile;
END $$;

COMMENT ON FUNCTION create_user_v1(TEXT,TEXT,TEXT,TEXT) IS
  'Phase 5.D : create auth user + profile. Returns user_profiles.id. Gated users.create.';

-- ===========================================================================
-- 2. update_user_role_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_user_role_v1(
  p_user_id       UUID,
  p_new_role_code TEXT,
  p_reason        TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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

  -- Last-admin guard : refuse downgrading the last remaining admin.
  IF v_old_role IN ('ADMIN','SUPER_ADMIN')
     AND p_new_role_code NOT IN ('ADMIN','SUPER_ADMIN')
     AND (
       SELECT count(*) FROM user_profiles
        WHERE role_code IN ('ADMIN','SUPER_ADMIN')
          AND deleted_at IS NULL
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
END $$;

COMMENT ON FUNCTION update_user_role_v1(UUID,TEXT,TEXT) IS
  'Phase 5.D : change a user role. Revokes active sessions. Audits change. Gated users.update.';

-- ===========================================================================
-- 3. delete_user_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION delete_user_v1(
  p_user_id UUID,
  p_reason  TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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

  -- Last-admin guard
  IF v_role_code IN ('ADMIN','SUPER_ADMIN')
     AND (
       SELECT count(*) FROM user_profiles
        WHERE role_code IN ('ADMIN','SUPER_ADMIN')
          AND deleted_at IS NULL
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
END $$;

COMMENT ON FUNCTION delete_user_v1(UUID,TEXT) IS
  'Phase 5.D : soft-delete a user. Refuses on last admin. Revokes sessions. Audits. Gated users.update.';

-- ===========================================================================
-- 4. update_user_profile_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION update_user_profile_v1(
  p_user_id       UUID,
  p_full_name     TEXT,
  p_employee_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_is_self        BOOLEAN;
  v_old            user_profiles%ROWTYPE;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'update_user_profile_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_caller_profile
    FROM user_profiles WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  v_is_self := (v_caller_profile = p_user_id);

  IF NOT v_is_self AND NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'update_user_profile_v1: missing permission users.update (or self)'
      USING ERRCODE = '42501';
  END IF;

  IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
    RAISE EXCEPTION 'update_user_profile_v1: full_name must be at least 2 chars' USING ERRCODE = '22023';
  END IF;
  IF p_employee_code IS NULL OR length(trim(p_employee_code)) < 3 THEN
    RAISE EXCEPTION 'update_user_profile_v1: employee_code must be at least 3 chars' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'update_user_profile_v1: user not found' USING ERRCODE = 'P0002';
  END IF;

  IF trim(p_employee_code) <> v_old.employee_code
     AND EXISTS (SELECT 1 FROM user_profiles
                  WHERE employee_code = trim(p_employee_code)
                    AND id <> p_user_id)
  THEN
    RAISE EXCEPTION 'update_user_profile_v1: employee_code % already exists', p_employee_code
      USING ERRCODE = '23505';
  END IF;

  UPDATE user_profiles
     SET full_name     = trim(p_full_name),
         employee_code = trim(p_employee_code),
         updated_at    = now()
   WHERE id = p_user_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile, 'user.profile_update', 'user_profile', p_user_id,
    jsonb_build_object(
      'old_full_name', v_old.full_name,
      'new_full_name', trim(p_full_name),
      'old_employee_code', v_old.employee_code,
      'new_employee_code', trim(p_employee_code),
      'is_self', v_is_self
    )
  );
END $$;

COMMENT ON FUNCTION update_user_profile_v1(UUID,TEXT,TEXT) IS
  'Phase 5.D : update full_name + employee_code. Allowed for self or users.update.';

-- ===========================================================================
-- 5. reset_user_pin_v1
-- ===========================================================================

CREATE OR REPLACE FUNCTION reset_user_pin_v1(
  p_user_id UUID,
  p_new_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_is_self        BOOLEAN;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'reset_user_pin_v1: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_caller_profile
    FROM user_profiles WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;

  v_is_self := (v_caller_profile = p_user_id);

  IF NOT v_is_self AND NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'reset_user_pin_v1: missing permission users.update (or self)'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_pin IS NULL OR length(p_new_pin) NOT BETWEEN 4 AND 8 OR p_new_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'reset_user_pin_v1: pin must be 4-8 digits' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_user_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'reset_user_pin_v1: user not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE user_profiles
     SET pin_hash              = hash_pin(p_new_pin),
         failed_login_attempts = 0,
         locked_until          = NULL,
         updated_at            = now()
   WHERE id = p_user_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile, 'user.pin_reset', 'user_profile', p_user_id,
    jsonb_build_object('is_self', v_is_self)
  );
END $$;

COMMENT ON FUNCTION reset_user_pin_v1(UUID,TEXT) IS
  'Phase 5.D : reset a user PIN. Clears lockout. Allowed for self or users.update.';

-- ===========================================================================
-- Grants
-- ===========================================================================

GRANT EXECUTE ON FUNCTION _revoke_user_sessions_v1(UUID)         TO authenticated;
GRANT EXECUTE ON FUNCTION create_user_v1(TEXT,TEXT,TEXT,TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_role_v1(UUID,TEXT,TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION delete_user_v1(UUID,TEXT)              TO authenticated;
GRANT EXECUTE ON FUNCTION update_user_profile_v1(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION reset_user_pin_v1(UUID,TEXT)           TO authenticated;

COMMIT;
