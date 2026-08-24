-- 20260825000005_bump_get_permission_changes_v2.sql
-- ADR-031 — le rapport « Permission changes » doit voir les overrides par utilisateur.
-- Corps repris du live pg_get_functiondef de get_permission_changes_v1 (jamais du
-- fichier d'origine), + les deux actions d'override dans le filtre. DROP v1 ici même
-- (versioning monotone).

CREATE OR REPLACE FUNCTION public.get_permission_changes_v2(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                         'role.session_timeout_changed', 'pin.locked',
                         'user.permission_override_set', 'user.permission_override_removed')
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
$function$;

DROP FUNCTION public.get_permission_changes_v1(text, text);

COMMENT ON FUNCTION public.get_permission_changes_v2(text, text) IS
  'ADR-031 — permission-changes report feed; adds user.permission_override_set/removed to the action filter.';

REVOKE ALL ON FUNCTION public.get_permission_changes_v2(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_permission_changes_v2(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_permission_changes_v2(text, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
