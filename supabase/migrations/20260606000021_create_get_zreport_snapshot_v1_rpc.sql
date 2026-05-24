-- 20260606000021_create_get_zreport_snapshot_v1_rpc.sql
-- S29 Wave 1.C.3 — get_zreport_snapshot_v1 : SELECT enrichi pour l'EF generate-zreport-pdf.
-- user_profiles.full_name verified existing (S29 DEV check passed).
CREATE OR REPLACE FUNCTION get_zreport_snapshot_v1(p_zreport_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_result       JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'zreports.read') THEN
    RAISE EXCEPTION 'Permission denied: zreports.read' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id',                z.id,
    'shift_id',          z.shift_id,
    'generated_at',      z.generated_at,
    'signed_at',         z.signed_at,
    'signed_by',         z.signed_by,
    'signed_by_name',    up.full_name,
    'voided_at',         z.voided_at,
    'voided_by',         z.voided_by,
    'void_reason',       z.void_reason,
    'pdf_storage_path',  z.pdf_storage_path,
    'status',            z.status,
    'snapshot',          z.snapshot
  )
  INTO v_result
  FROM z_reports z
  LEFT JOIN user_profiles up ON up.id = z.signed_by
  WHERE z.id = p_zreport_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Z-Report % not found', p_zreport_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_zreport_snapshot_v1(UUID) IS
  'S29 : SELECT enrichi (jointure user_profiles signed_by → full_name) pour le rendering PDF côté EF.';
