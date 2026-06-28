-- S50 Vague 2a-i · T5 — void_zreport → v2 : PIN manager validé serveur
--
-- void_zreport_v1 annulait un Z-Report (clôture de caisse signée) sur la seule perm
-- zreports.void, SANS PIN manager — alors que sign_zreport_v2 (S37 BO-01) exige et valide
-- déjà un PIN. Annuler une clôture est au moins aussi sensible que la signer : on aligne.
--
-- v2 : ajoute p_manager_pin TEXT, vérifié serveur via _verify_pin_with_lockout (idiome
-- sign_zreport_v2 / close_fiscal_period_v1 / create_manual_je_v1). Le reste est inchangé
-- (perm zreports.void, raison >= 10 car, replay idempotent sur déjà-annulé, audit_log).
-- DROP v1 + REVOKE pair. PIN en arg RPC (appel direct BO, pas via EF) — conforme au pattern
-- des RPC PIN du projet ; la règle « PIN en header » ne vise que les Edge Functions.

CREATE OR REPLACE FUNCTION public.void_zreport_v2(
  p_zreport_id uuid,
  p_reason text,
  p_manager_pin text
)
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

  -- PIN manager exigé et réellement validé (idiome sign_zreport_v2 / close_fiscal_period_v1).
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
      voided_by = v_caller_id,
      void_reason = trim(p_reason)
  WHERE id = p_zreport_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'zreport.void', 'z_report', p_zreport_id,
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

-- DROP v1 (signature d'origine) + REVOKE pair sur v2 (defense-in-depth anon)
DROP FUNCTION IF EXISTS public.void_zreport_v1(uuid, text);

REVOKE ALL ON FUNCTION public.void_zreport_v2(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_zreport_v2(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.void_zreport_v2(uuid, text, text) TO authenticated;
