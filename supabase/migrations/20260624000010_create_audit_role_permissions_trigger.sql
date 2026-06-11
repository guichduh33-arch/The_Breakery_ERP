-- 20260624000010_create_audit_role_permissions_trigger.sql
-- S40 Wave A — audit trail on role_permissions grants/revokes.
-- Closes the RBAC observability gap: before this, only
-- role.session_timeout_changed was audited; permission grants were invisible.
-- Columns confirmed: role_permissions has (role_code TEXT, permission_code TEXT).
-- audit_logs canonical cols: actor_id / action / entity_type / entity_id / metadata / payload.
-- Uses payload column (added S19 via 20260523000019_audit_logs_add_payload.sql).

CREATE OR REPLACE FUNCTION public.audit_role_permissions_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (auth.uid(), 'role.permission_granted', 'role', NULL,
            jsonb_build_object('role_code', NEW.role_code, 'permission_code', NEW.permission_code));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (auth.uid(), 'role.permission_revoked', 'role', NULL,
            jsonb_build_object('role_code', OLD.role_code, 'permission_code', OLD.permission_code));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_role_permissions ON public.role_permissions;
CREATE TRIGGER trg_audit_role_permissions
  AFTER INSERT OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_role_permissions_changes();

COMMENT ON FUNCTION public.audit_role_permissions_changes() IS
  'S40 — writes role.permission_granted / role.permission_revoked rows to audit_logs. '
  'actor_id is auth.uid() (NULL for seed/migration writes).';

REVOKE ALL ON FUNCTION public.audit_role_permissions_changes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_role_permissions_changes() FROM anon;
