-- 20260606000017_create_sign_zreport_v1_rpc.sql
-- S29 Wave 1.C.1 — sign_zreport_v1 : transition draft → signed.
-- PIN-en-header (S25 pattern) : the EF wrapper checks the manager PIN before calling.
-- The RPC itself only validates the caller has zreports.sign permission.
-- Idempotency replay : re-call on already-signed returns idempotent_replay=true.
CREATE OR REPLACE FUNCTION sign_zreport_v1(p_zreport_id UUID)
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

  IF NOT has_permission(v_caller_id, 'zreports.sign') THEN
    RAISE EXCEPTION 'Permission denied: zreports.sign' USING ERRCODE = '42501';
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
    jsonb_build_object('shift_id', v_zreport.shift_id));

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

COMMENT ON FUNCTION sign_zreport_v1(UUID) IS
  'S29 : sign Z-Report draft → signed. PIN-en-header vérifié côté EF wrapper (RPC checks perm uniquement). Idempotent : re-call sur signed retourne idempotent_replay=true.';
