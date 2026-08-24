-- 20260825000002_fix_audit_role_permissions_actor_profile.sql
-- ADR-031 — conformité audit-trail : audit_logs.actor_id attend un user_profiles.id,
-- jamais auth.uid() (tout compte créé par le back-office a id <> auth_user_id : le
-- LEFT JOIN du rapport permission-changes le rendait « system »).
-- Fonction trigger interne, non appelable client : le versioning _vN ne s'applique pas
-- (le fichier d'origine 20260624000010 utilisait déjà CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.audit_role_permissions_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
BEGIN
  -- Résolution du profil appelant ; reste NULL pour les écritures de seed/migration.
  SELECT id INTO v_actor
  FROM user_profiles
  WHERE auth_user_id = auth.uid() AND deleted_at IS NULL
  LIMIT 1;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_actor, 'role.permission_granted', 'role', NULL,
            jsonb_build_object('role_code', NEW.role_code, 'permission_code', NEW.permission_code));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
    VALUES (v_actor, 'role.permission_revoked', 'role', NULL,
            jsonb_build_object('role_code', OLD.role_code, 'permission_code', OLD.permission_code));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.audit_role_permissions_changes() IS
  'ADR-031 — writes role.permission_granted / role.permission_revoked rows to audit_logs. '
  'actor_id resolves user_profiles.id from auth.uid() (NULL for seed/migration writes).';

REVOKE ALL ON FUNCTION public.audit_role_permissions_changes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_role_permissions_changes() FROM anon;
