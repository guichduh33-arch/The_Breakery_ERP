-- 20260710000100_pin_length_6.sql
-- Vague 0 / Tâche 3c — aligner la longueur du PIN partout (fiche 01 D1.1).
--
-- Problem : `create_user_v1` / `reset_user_pin_v1` accept a 4-8 digit PIN
-- (`20260517000200_create_user_rpcs.sql`), but the login path
-- (`auth-verify-pin` EF, `supabase/functions/auth-verify-pin/index.ts:11`)
-- requires exactly 6 digits (`^\d{6}$`). A PIN created with 4-5 or 7-8
-- digits is silently unusable at login.
--
-- Fix : in-place validation tightening on both RPCs — signature unchanged
-- (no _v2 bump), per project precedent P10 (internal validation-rule change,
-- not a contract change). Per DEV-S57-02, the bodies below are copied from
-- the LIVE `pg_get_functiondef()` output (verified identical to the
-- 20260517000200 migration file at authoring time — no drift), not from the
-- original migration file, and only the PIN-length predicate + error
-- message change ; everything else (permission gates, audit rows, session
-- revocation) is byte-for-byte preserved.

BEGIN;

-- ===========================================================================
-- 1. create_user_v1 — PIN must be exactly 6 digits (was 4-8).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_user_v1(
  p_employee_code TEXT,
  p_full_name     TEXT,
  p_role_code     TEXT,
  p_pin           TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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

  IF p_employee_code IS NULL OR length(trim(p_employee_code)) < 3 THEN
    RAISE EXCEPTION 'create_user_v1: employee_code must be at least 3 chars' USING ERRCODE = '22023';
  END IF;
  IF p_full_name IS NULL OR length(trim(p_full_name)) < 2 THEN
    RAISE EXCEPTION 'create_user_v1: full_name must be at least 2 chars' USING ERRCODE = '22023';
  END IF;
  IF p_pin IS NULL OR length(p_pin) != 6 OR p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'create_user_v1: pin must be exactly 6 digits' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE code = p_role_code) THEN
    RAISE EXCEPTION 'create_user_v1: unknown role_code %', p_role_code USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM user_profiles WHERE employee_code = trim(p_employee_code)) THEN
    RAISE EXCEPTION 'create_user_v1: employee_code % already exists', p_employee_code USING ERRCODE = '23505';
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

COMMENT ON FUNCTION public.create_user_v1(TEXT,TEXT,TEXT,TEXT) IS
  'Phase 5.D : create auth user + profile. Returns user_profiles.id. Gated users.create. PIN exactly 6 digits (S58 in-place, was 4-8).';

-- ===========================================================================
-- 2. reset_user_pin_v1 — PIN must be exactly 6 digits (was 4-8).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.reset_user_pin_v1(
  p_user_id UUID,
  p_new_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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

  IF p_new_pin IS NULL OR length(p_new_pin) != 6 OR p_new_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'reset_user_pin_v1: pin must be exactly 6 digits' USING ERRCODE = '22023';
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
END $function$;

COMMENT ON FUNCTION public.reset_user_pin_v1(UUID,TEXT) IS
  'Phase 5.D : reset a user PIN. Clears lockout. Allowed for self or users.update. PIN exactly 6 digits (S58 in-place, was 4-8).';

COMMIT;
