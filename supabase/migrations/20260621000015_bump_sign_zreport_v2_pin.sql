-- 20260621000015_bump_sign_zreport_v2_pin.sql
-- Session 37 / Wave A / Task A5 (BO-01) — D3 ratifiée : bump sign_zreport_v1 → v2
-- avec validation du PIN manager EN ARGUMENT (appel BO interne, pas de nouvel EF).
-- v1 supposait un "EF wrapper" qui vérifiait le PIN — wrapper jamais déployé : le hook BO
-- envoyait un header x-manager-pin que personne ne lisait → signature sans PIN réel.
-- v2 valide via verify_user_pin(profile du caller) + garde le gate zreports.sign,
-- l'idempotent replay et l'audit. DROP v1 + REVOKE pair S25 dans la même migration.

DROP FUNCTION IF EXISTS public.sign_zreport_v1(UUID);

CREATE OR REPLACE FUNCTION sign_zreport_v2(p_zreport_id UUID, p_manager_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  IF NOT verify_user_pin(v_profile_id, p_manager_pin) THEN
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
      signed_by = v_caller_id
  WHERE id = p_zreport_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'zreport.sign', 'z_report', p_zreport_id,
    jsonb_build_object('shift_id', v_zreport.shift_id, 'rpc_version', 'v2', 'pin_validated', true));

  RETURN jsonb_build_object(
    'zreport_id',         p_zreport_id,
    'status',             'signed',
    'signed_at',          now(),
    'signed_by',          v_caller_id,
    'pdf_storage_path',   v_zreport.pdf_storage_path,
    'idempotent_replay',  false
  );
END;
$$;

COMMENT ON FUNCTION sign_zreport_v2(UUID, TEXT) IS
  'S37 bump v1 → v2 (BO-01) : valide réellement le PIN manager via verify_user_pin '
  '(v1 déléguait à un EF wrapper jamais déployé). Gate zreports.sign + idempotent replay + audit.';

-- REVOKE pair canonique S25.
REVOKE EXECUTE ON FUNCTION public.sign_zreport_v2(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sign_zreport_v2(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.sign_zreport_v2(UUID, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
