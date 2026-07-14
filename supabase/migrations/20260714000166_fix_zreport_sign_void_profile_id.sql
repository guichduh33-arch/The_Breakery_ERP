-- S77 post-merge (F-5) — sign_zreport_v2 / void_zreport_v2 : même bug de classe
-- que close_shift (_142, S72) : le RPC résout correctement v_profile_id (il s'en
-- sert pour le PIN) mais écrit v_caller_id = auth.uid() (l'auth_user_id) dans
-- z_reports.signed_by / voided_by ET audit_logs.actor_id — trois FKs vers
-- user_profiles(id). Pour tout employé créé par la vraie chaîne d'embauche
-- (create_user_v1 : id <> auth_user_id), la signature/annulation d'un Z-report
-- lève foreign_key_violation (23503) et TOUTE la transaction est annulée — le
-- manager ne peut pas signer. Masqué depuis toujours par les comptes seed
-- (id == auth_user_id) ; démasqué par le nightly S77 (les fixtures LIMIT 1
-- tombent désormais sur des employés réels).
--
-- Fix = corps live pg_get_functiondef (2026-07-14) VERBATIM avec pour SEULES
-- éditions les 4 écritures v_caller_id -> v_profile_id (UPDATE signed_by,
-- envelope signed_by, UPDATE voided_by, les 2 actor_id d'audit). Body-only,
-- signature inchangée (précédent S74 _153) — les call-sites front restent
-- sur _v2. Suites garde-fou : sign_zreport_pin.test.sql + pin_lockout.test.sql.

CREATE OR REPLACE FUNCTION public.sign_zreport_v2(p_zreport_id uuid, p_manager_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_profile_id UUID;
  v_zreport    z_reports%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'zreports.sign') THEN
    RAISE EXCEPTION 'Permission denied: zreports.sign' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_caller_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = '42501';
  END IF;

  -- S37 BO-01 : le PIN est exigé et réellement validé (idiome close_fiscal_period_v1).
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT _verify_pin_with_lockout(v_profile_id, p_manager_pin) THEN
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_zreport FROM z_reports WHERE id = p_zreport_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Z-Report % not found', p_zreport_id USING ERRCODE = 'P0002';
  END IF;

  IF v_zreport.status = 'voided' THEN
    RAISE EXCEPTION 'Cannot sign voided Z-Report' USING ERRCODE = 'P0003';
  END IF;

  IF v_zreport.status = 'signed' THEN
    RETURN jsonb_build_object(
      'zreport_id',         v_zreport.id,
      'status',             v_zreport.status,
      'signed_at',          v_zreport.signed_at,
      'signed_by',          v_zreport.signed_by,
      'pdf_storage_path',   v_zreport.pdf_storage_path,
      'idempotent_replay',  true
    );
  END IF;

  UPDATE z_reports
  SET status = 'signed',
      signed_at = now(),
      signed_by = v_profile_id
  WHERE id = p_zreport_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'zreport.sign', 'z_report', p_zreport_id,
    jsonb_build_object('shift_id', v_zreport.shift_id, 'rpc_version', 'v2', 'pin_validated', true));

  RETURN jsonb_build_object(
    'zreport_id',         p_zreport_id,
    'status',             'signed',
    'signed_at',          now(),
    'signed_by',          v_profile_id,
    'pdf_storage_path',   v_zreport.pdf_storage_path,
    'idempotent_replay',  false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_zreport_v2(p_zreport_id uuid, p_reason text, p_manager_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_profile_id UUID;
  v_zreport    z_reports%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'zreports.void') THEN
    RAISE EXCEPTION 'Permission denied: zreports.void' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_caller_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = '42501';
  END IF;

  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF NOT _verify_pin_with_lockout(v_profile_id, p_manager_pin) THEN
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Reason must be at least 10 characters' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_zreport FROM z_reports WHERE id = p_zreport_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Z-Report % not found', p_zreport_id USING ERRCODE = 'P0002';
  END IF;

  IF v_zreport.status = 'voided' THEN
    RETURN jsonb_build_object(
      'zreport_id',         v_zreport.id,
      'status',             v_zreport.status,
      'voided_at',          v_zreport.voided_at,
      'idempotent_replay',  true
    );
  END IF;

  UPDATE z_reports
  SET status = 'voided',
      voided_at = now(),
      voided_by = v_profile_id,
      void_reason = trim(p_reason)
  WHERE id = p_zreport_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'zreport.void', 'z_report', p_zreport_id,
    jsonb_build_object('shift_id', v_zreport.shift_id, 'reason', trim(p_reason),
                       'rpc_version', 'v2', 'pin_validated', true));

  RETURN jsonb_build_object(
    'zreport_id', p_zreport_id,
    'status',     'voided',
    'voided_at',  now(),
    'idempotent_replay', false
  );
END;
$function$;
