-- Corps live conservés ; le refus PIN retourne sans annuler le compteur de sécurité.
CREATE OR REPLACE FUNCTION public.sign_zreport_v3(p_zreport_id uuid, p_manager_pin text)
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
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
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
    jsonb_build_object('shift_id', v_zreport.shift_id, 'rpc_version', 'v3', 'pin_validated', true));

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
DROP FUNCTION public.sign_zreport_v2(uuid,text);
REVOKE ALL ON FUNCTION public.sign_zreport_v3(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_zreport_v3(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.void_zreport_v3(p_zreport_id uuid, p_reason text, p_manager_pin text)
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
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
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
                       'rpc_version', 'v3', 'pin_validated', true));

  RETURN jsonb_build_object(
    'zreport_id', p_zreport_id,
    'status',     'voided',
    'voided_at',  now(),
    'idempotent_replay', false
  );
END;
$function$;
DROP FUNCTION public.void_zreport_v2(uuid,text,text);
REVOKE ALL ON FUNCTION public.void_zreport_v3(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_zreport_v3(uuid,text,text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
