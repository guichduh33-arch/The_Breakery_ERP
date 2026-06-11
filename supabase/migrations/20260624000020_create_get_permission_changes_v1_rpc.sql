-- 20260624000020_create_get_permission_changes_v1_rpc.sql
-- S40 — Permission/RBAC change log from audit_logs. Gate audit_log.read
-- (granted ADMIN/SUPER_ADMIN only — verified on cloud, same gate as AuditPage S13).
-- Sources the S40 trigger rows (role.permission_granted/revoked) plus the
-- pre-existing role.session_timeout_changed (S19) and pin.locked events.
-- role_code / permission_code extracted from payload (NULL for timeout/pin rows
-- whose role_code may live elsewhere in the payload — passthrough via detail).

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
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'audit_log.read') THEN
    RAISE EXCEPTION 'permission denied: audit_log.read required'
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
  'from audit_logs. Gate audit_log.read (ADMIN+).';

REVOKE ALL ON FUNCTION public.get_permission_changes_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_permission_changes_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_permission_changes_v1(TEXT, TEXT) TO authenticated;
