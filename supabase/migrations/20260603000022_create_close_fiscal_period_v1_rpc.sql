-- 20260603000022_create_close_fiscal_period_v1_rpc.sql
-- Session 26 / Wave 1.I / migration _022 :
--   close_fiscal_period_v1(p_period_id, p_manager_pin) RETURNS JSONB
--
-- Marque une période fiscale en status='closed' (ou 'locked' selon p_lock).
-- Gate : permission accounting.period.close + PIN manager.
-- Audit_log : 1 row 'accounting.period.closed' avec payload détaillé.

CREATE OR REPLACE FUNCTION public.close_fiscal_period_v1(
  p_period_id     UUID,
  p_manager_pin   TEXT,
  p_lock          BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_profile UUID;
  v_period  RECORD;
  v_new_status TEXT;
BEGIN
  IF p_period_id IS NULL THEN
    RAISE EXCEPTION 'period_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_manager_pin IS NULL OR length(p_manager_pin) < 4 THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT public.has_permission(v_uid, 'accounting.period.close') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.verify_user_pin(v_profile, p_manager_pin) THEN
    RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_period FROM fiscal_periods WHERE id = p_period_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'period_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_period.status = 'locked' THEN
    RAISE EXCEPTION 'period_already_locked' USING ERRCODE = 'P0003';
  END IF;
  IF v_period.status = 'closed' AND NOT p_lock THEN
    RAISE EXCEPTION 'period_already_closed' USING ERRCODE = 'P0003';
  END IF;

  v_new_status := CASE WHEN p_lock THEN 'locked' ELSE 'closed' END;

  IF p_lock THEN
    UPDATE fiscal_periods
      SET status = v_new_status,
          locked_by = v_profile,
          locked_at = now()
      WHERE id = p_period_id;
  ELSE
    UPDATE fiscal_periods
      SET status = v_new_status,
          closed_by = v_profile,
          closed_at = now()
      WHERE id = p_period_id;
  END IF;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'accounting.period.closed',
    'fiscal_periods',
    p_period_id,
    jsonb_build_object(
      'period_start', v_period.period_start,
      'period_end',   v_period.period_end,
      'old_status',   v_period.status,
      'new_status',   v_new_status
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'period_id',   p_period_id,
    'period_start', v_period.period_start,
    'period_end',   v_period.period_end,
    'new_status',  v_new_status,
    'closed_at',   now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.close_fiscal_period_v1(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_fiscal_period_v1(UUID, TEXT, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.close_fiscal_period_v1(UUID, TEXT, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.close_fiscal_period_v1(UUID, TEXT, BOOLEAN) IS
  'S26 cockpit : ferme une période fiscale (closed ou locked si p_lock=true). '
  'Gate accounting.period.close + PIN manager. Audit_log row accounting.period.closed.';
