-- 20260825000006_bump_update_role_session_timeout_v2.sql
-- ADR-031 arbitrage 4 — « ADMIN perd l'édition des timeouts » : le gate rôle passe
-- de ('SUPER_ADMIN','ADMIN') à SUPER_ADMIN seul. Finding HIGH de la review de branche :
-- sans ce bump, la décision n'était appliquée qu'en façade UI.
-- Corps repris du live pg_get_functiondef de update_role_session_timeout_v1 ; au passage,
-- conformité CLAUDE.md : audit_logs.actor_id = user_profiles.id (v1 écrivait auth.uid()),
-- et le lookup profil filtre deleted_at IS NULL.
--
-- Error map :
--   P0003 'unauthenticated' / 'forbidden' (settings.update) / 'super_admin_only'.
--   P0001 'invalid_minutes' — hors [5, 480].
--   P0002 'role_not_found'.

CREATE OR REPLACE FUNCTION public.update_role_session_timeout_v2(
  p_role_code TEXT,
  p_minutes   INT
) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid         UUID := auth.uid();
  v_caller_id   UUID;
  v_caller_role TEXT;
  v_before      INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'P0003';
  END IF;

  IF NOT has_permission(v_uid, 'settings.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  SELECT id, role_code INTO v_caller_id, v_caller_role
  FROM user_profiles
  WHERE auth_user_id = v_uid AND deleted_at IS NULL
  LIMIT 1;

  IF v_caller_role IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = 'P0003';
  END IF;

  IF p_minutes IS NULL OR p_minutes < 5 OR p_minutes > 480 THEN
    RAISE EXCEPTION 'invalid_minutes' USING ERRCODE = 'P0001';
  END IF;

  SELECT session_timeout_minutes INTO v_before FROM roles WHERE code = p_role_code;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'role_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE roles SET session_timeout_minutes = p_minutes WHERE code = p_role_code;

  -- entity_id NULL : la PK de roles est TEXT (déviation DEV-S19-1.B-01 conservée).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_caller_id,
    'role.session_timeout_changed',
    'roles',
    NULL,
    jsonb_build_object(
      'role_code', p_role_code,
      'before',    v_before,
      'after',     p_minutes
    )
  );

  RETURN TRUE;
END;
$$;

DROP FUNCTION public.update_role_session_timeout_v1(TEXT, INT);

COMMENT ON FUNCTION public.update_role_session_timeout_v2(TEXT, INT) IS
  'ADR-031 — SUPER_ADMIN-only mutate of roles.session_timeout_minutes with audit log (actor_id = profile id).';

REVOKE ALL ON FUNCTION public.update_role_session_timeout_v2(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_role_session_timeout_v2(TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_role_session_timeout_v2(TEXT, INT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
