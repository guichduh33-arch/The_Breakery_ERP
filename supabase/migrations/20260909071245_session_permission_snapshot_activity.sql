-- Les sessions antérieures restent sans snapshot : une nouvelle connexion est requise.
-- Aucun backfill de droits recalculés, aucune suppression de sessions ou d'outbox.
ALTER TABLE public.user_sessions
  ADD COLUMN permissions_snapshot text[],
  ADD COLUMN session_timeout_minutes integer
    CHECK (session_timeout_minutes BETWEEN 5 AND 480);

CREATE FUNCTION public.touch_user_session_v1(p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public
AS $function$
DECLARE v_id uuid;
BEGIN
  -- Une seule écriture conditionnelle : ne ressuscite jamais une session expirée.
  UPDATE user_sessions s SET last_activity_at = now()
  FROM user_profiles p
  WHERE s.id = p_session_id AND p.id = s.user_id
    AND p.is_active = true AND p.deleted_at IS NULL AND p.auth_user_id IS NOT NULL
    AND s.ended_at IS NULL AND s.permissions_snapshot IS NOT NULL
    AND s.session_timeout_minutes BETWEEN 5 AND 480
    AND s.created_at > now() - interval '24 hours'
    AND s.created_at <= now() AND s.last_activity_at <= now()
    AND s.last_activity_at > now() - make_interval(mins => s.session_timeout_minutes)
  RETURNING s.id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.touch_user_session_v1(uuid) FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_user_session_v1(uuid) TO service_role;
