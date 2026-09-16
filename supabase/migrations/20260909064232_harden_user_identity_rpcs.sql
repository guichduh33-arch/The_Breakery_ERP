-- Corps relevés par pg_get_functiondef sur V3 dev le 2026-09-09.
-- Appelant actif obligatoire et protection des identités SUPER_ADMIN.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_user_v2(p_employee_code text, p_full_name text, p_role_code text, p_pin text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_uid    UUID := auth.uid();
  v_caller_prof   UUID;
  v_new_auth_id   UUID := gen_random_uuid();
  v_new_profile   UUID;
  v_email         TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('user_identity_mutation', 0));
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'create_user_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'users.create') THEN
    RAISE EXCEPTION 'create_user_v2: missing permission users.create' USING ERRCODE = '42501';
  END IF;

  SELECT id, role_code INTO v_caller_prof, v_caller_role FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL AND is_active = true
    LIMIT 1 FOR SHARE;
  IF v_caller_prof IS NULL THEN
    RAISE EXCEPTION 'active_profile_required' USING ERRCODE = '42501';
  END IF;

  IF p_employee_code IS NULL OR length(trim(p_employee_code)) < 3 THEN
    RAISE EXCEPTION 'create_user_v2: employee_code must be at least 3 chars' USING ERRCODE = '22023';
  END IF;
  IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
    RAISE EXCEPTION 'create_user_v2: full_name must be at least 2 chars' USING ERRCODE = '22023';
  END IF;
  IF p_pin IS NULL OR length(p_pin) != 6 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'create_user_v2: pin must be exactly 6 digits' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = p_role_code) THEN
    RAISE EXCEPTION 'create_user_v2: unknown role_code %', p_role_code USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM user_profiles WHERE employee_code = trim(p_employee_code)) THEN
    RAISE EXCEPTION 'create_user_v2: employee_code % already exists', p_employee_code USING ERRCODE = '23505';
  END IF;

  IF (p_role_code = 'SUPER_ADMIN') AND v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
  END IF;

  v_email := 'staff-' || lower(trim(p_employee_code)) || '@thebreakery.local';

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

  INSERT INTO user_profiles (
    auth_user_id, employee_code, full_name, pin_hash, role_code, is_active
  ) VALUES (
    v_new_auth_id, trim(p_employee_code), trim(p_full_name),
    hash_pin(p_pin), p_role_code, true
  )
  RETURNING id INTO v_new_profile;

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
END $function$;

REVOKE ALL ON FUNCTION public.create_user_v2(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_user_v2(text, text, text, text) TO authenticated, service_role;
DROP FUNCTION public.create_user_v1(text, text, text, text);

CREATE OR REPLACE FUNCTION public.update_user_role_v2(p_user_id uuid, p_new_role_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_uid       UUID := auth.uid();
  v_caller_prof      UUID;
  v_old_role         TEXT;
  v_revoked          INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('user_identity_mutation', 0));
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'update_user_role_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'update_user_role_v2: missing permission users.update' USING ERRCODE = '42501';
  END IF;

  SELECT id, role_code INTO v_caller_prof, v_caller_role FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL AND is_active = true
    LIMIT 1 FOR SHARE;
  IF v_caller_prof IS NULL THEN
    RAISE EXCEPTION 'active_profile_required' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'update_user_role_v2: reason must be at least 3 chars' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = p_new_role_code) THEN
    RAISE EXCEPTION 'update_user_role_v2: unknown role_code %', p_new_role_code USING ERRCODE = '23503';
  END IF;

  SELECT role_code INTO v_old_role
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL
     FOR UPDATE;

  IF v_old_role IS NULL THEN
    RAISE EXCEPTION 'update_user_role_v2: user not found or deleted' USING ERRCODE = 'P0002';
  END IF;

  IF (v_old_role = 'SUPER_ADMIN' OR p_new_role_code = 'SUPER_ADMIN') AND v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.update_user_role_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_role_v2(uuid, text, text) TO authenticated, service_role;
DROP FUNCTION public.update_user_role_v1(uuid, text, text);

CREATE OR REPLACE FUNCTION public.update_user_profile_v2(p_user_id uuid, p_full_name text, p_employee_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_is_self        BOOLEAN;
  v_old            user_profiles%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('user_identity_mutation', 0));
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'update_user_profile_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id, role_code INTO v_caller_profile, v_caller_role FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL AND is_active = true
    LIMIT 1 FOR SHARE;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'active_profile_required' USING ERRCODE = '42501';
  END IF;

  v_is_self := (v_caller_profile = p_user_id);

  IF NOT v_is_self AND NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'update_user_profile_v2: missing permission users.update (or self)'
      USING ERRCODE = '42501';
  END IF;

  IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
    RAISE EXCEPTION 'update_user_profile_v2: full_name must be at least 2 chars' USING ERRCODE = '22023';
  END IF;
  IF p_employee_code IS NULL OR length(trim(p_employee_code)) < 3 THEN
    RAISE EXCEPTION 'update_user_profile_v2: employee_code must be at least 3 chars' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'update_user_profile_v2: user not found' USING ERRCODE = 'P0002';
  END IF;

  IF (v_old.role_code = 'SUPER_ADMIN') AND v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
  END IF;

  IF trim(p_employee_code) <> v_old.employee_code
     AND EXISTS (SELECT 1 FROM user_profiles
                  WHERE employee_code = trim(p_employee_code)
                    AND id <> p_user_id)
  THEN
    RAISE EXCEPTION 'update_user_profile_v2: employee_code % already exists', p_employee_code
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
END $function$;

REVOKE ALL ON FUNCTION public.update_user_profile_v2(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_profile_v2(uuid, text, text) TO authenticated, service_role;
DROP FUNCTION public.update_user_profile_v1(uuid, text, text);

CREATE OR REPLACE FUNCTION public.delete_user_v2(p_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_caller_role TEXT;
  v_caller_uid   UUID := auth.uid();
  v_caller_prof  UUID;
  v_role_code    TEXT;
  v_deleted_at   TIMESTAMPTZ;
  v_revoked      INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('user_identity_mutation', 0));
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'delete_user_v2: caller not authenticated' USING ERRCODE = '28000';
  END IF;

  IF NOT has_permission(v_caller_uid, 'users.update') THEN
    RAISE EXCEPTION 'delete_user_v2: missing permission users.update' USING ERRCODE = '42501';
  END IF;

  SELECT id, role_code INTO v_caller_prof, v_caller_role FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL AND is_active = true
    LIMIT 1 FOR SHARE;
  IF v_caller_prof IS NULL THEN
    RAISE EXCEPTION 'active_profile_required' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'delete_user_v2: reason must be at least 3 chars' USING ERRCODE = '22023';
  END IF;

  SELECT role_code INTO v_role_code
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL
     FOR UPDATE;

  IF v_role_code IS NULL THEN
    RAISE EXCEPTION 'delete_user_v2: user not found or already deleted'
      USING ERRCODE = 'P0002';
  END IF;

  IF (v_role_code = 'SUPER_ADMIN') AND v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
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

REVOKE ALL ON FUNCTION public.delete_user_v2(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_user_v2(uuid, text) TO authenticated, service_role;
DROP FUNCTION public.delete_user_v1(uuid, text);
