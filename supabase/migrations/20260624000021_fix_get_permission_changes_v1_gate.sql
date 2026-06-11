-- 20260624000021_fix_get_permission_changes_v1_gate.sql
-- S40 corrective (DEV-S40-C-01) — align the RPC gate with the front-end.
-- The plan said `audit_log.read` but also instructed to copy the AuditPage gate;
-- the AuditPage route gates on `reports.audit.read` (MANAGER/ADMIN/SUPER_ADMIN)
-- and its backend get_audit_logs_v1 carries no RPC gate at all (RLS only).
-- Keeping `audit_log.read` (ADMIN+) would 42501 every MANAGER who can already
-- read the raw audit log — front route (Wave C) gates on reports.audit.read.

CREATE OR REPLACE FUNCTION public.get_permission_changes_v1(
  p_date_start TEXT,
  p_date_end   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start DATE; v_end DATE; v_tz TEXT;
  v_changes JSONB; v_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.audit.read') THEN
    RAISE EXCEPTION 'permission denied: reports.audit.read required'
      USING ERRCODE = '42501';
  END IF;
  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH in_range AS (
    SELECT al.created_at,
           al.actor_id,
           al.action,
           al.payload
      FROM audit_logs al
     WHERE al.action IN ('role.permission_granted', 'role.permission_revoked',
                         'role.session_timeout_changed', 'pin.locked')
       AND ((al.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     ORDER BY al.created_at DESC
     LIMIT 501
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'changed_at',      ir.created_at,
             'actor_name',      COALESCE(up.full_name, 'system'),
             'action',          ir.action,
             'role_code',       ir.payload->>'role_code',
             'permission_code', ir.payload->>'permission_code',
             'detail',          ir.payload
           ) ORDER BY ir.created_at DESC
         ), '[]'::jsonb),
         COUNT(*)
    INTO v_changes, v_count
    FROM in_range ir
    LEFT JOIN user_profiles up ON up.id = ir.actor_id;

  IF v_count > 500 THEN
    v_changes := (SELECT jsonb_agg(e) FROM (
      SELECT e FROM jsonb_array_elements(v_changes) e LIMIT 500
    ) t);
  END IF;

  RETURN jsonb_build_object(
    'period',    jsonb_build_object('start', v_start, 'end', v_end),
    'changes',   v_changes,
    'truncated', v_count > 500
  );
END;
$$;

COMMENT ON FUNCTION public.get_permission_changes_v1(TEXT, TEXT) IS
  'S40 — RBAC/permission change log (grants, revokes, session timeout, pin lockouts) '
  'from audit_logs. Gate reports.audit.read (MANAGER+, aligned with AuditPage — corrective _021).';

-- REVOKE pair re-asserted (CREATE OR REPLACE preserves ACLs, defense-in-depth)
REVOKE ALL ON FUNCTION public.get_permission_changes_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_permission_changes_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_permission_changes_v1(TEXT, TEXT) TO authenticated;
