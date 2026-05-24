-- 20260606000019_create_void_zreport_v1_rpc.sql
-- S29 Wave 1.C.2 — void_zreport_v1 admin-only avec reason (min 10 char).
CREATE OR REPLACE FUNCTION void_zreport_v1(p_zreport_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_zreport    z_reports%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'zreports.void') THEN
    RAISE EXCEPTION 'Permission denied: zreports.void' USING ERRCODE = '42501';
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
    jsonb_build_object('shift_id', v_zreport.shift_id, 'reason', trim(p_reason)));

  RETURN jsonb_build_object(
    'zreport_id', p_zreport_id,
    'status',     'voided',
    'voided_at',  now(),
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION void_zreport_v1(UUID, TEXT) IS
  'S29 : void Z-Report (admin only). Préserve pdf_storage_path pour audit trail. Reason min 10 char enforced.';
