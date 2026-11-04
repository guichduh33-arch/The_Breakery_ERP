-- Consultation commune des audits métier et des gestes POS, sans copier les ledgers.
-- Bornes et filtres repris de la définition live de get_audit_logs, lue le 04/11/2026.
CREATE FUNCTION public.get_activity_logs_v1(
  p_cursor text DEFAULT NULL, p_limit integer DEFAULT 50,
  p_actor_id uuid DEFAULT NULL, p_action text DEFAULT NULL,
  p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL,
  p_date_start text DEFAULT NULL, p_date_end text DEFAULT NULL
)
RETURNS TABLE (
  id text, actor_id uuid, actor_name text, action text, entity_type text,
  entity_id uuid, metadata jsonb, payload jsonb, created_at timestamptz, source text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
    FROM business_config WHERE id = 1
  ), bounds AS (
    SELECT
      CASE WHEN p_date_start IS NULL THEN NULL
           ELSE p_date_start::date::timestamp AT TIME ZONE (SELECT tz FROM cfg) END AS lo,
      CASE WHEN p_date_end IS NULL THEN NULL
           ELSE (p_date_end::date + 1)::timestamp AT TIME ZONE (SELECT tz FROM cfg) END AS hi
  ), unified AS (
    SELECT 'audit:' || lpad(al.id::text, 20, '0') AS id, al.actor_id,
      al.action, al.entity_type, al.entity_id, al.metadata, al.payload,
      al.created_at, 'audit'::text AS source
    FROM audit_logs al, bounds b
    WHERE (b.lo IS NULL OR al.created_at >= b.lo)
      AND (b.hi IS NULL OR al.created_at < b.hi)
    UNION ALL
    SELECT 'pos:' || e.id::text, e.actor_id, 'pos.' || e.event_type::text,
      CASE WHEN e.order_id IS NULL THEN 'pos_device' ELSE 'order' END,
      COALESCE(e.order_id, e.device_id),
      jsonb_strip_nulls(jsonb_build_object(
        'order_number', e.order_number_snap, 'amount', e.amount, 'reason', e.reason,
        'device_id', e.device_id, 'session_id', e.session_id,
        'order_item_id', e.order_item_id, 'recorded_at', e.recorded_at,
        'synced_by', e.synced_by, 'source', 'client'
      )), e.payload, e.occurred_at, 'pos'::text
    FROM pos_events e, bounds b
    WHERE (b.lo IS NULL OR e.occurred_at >= b.lo)
      AND (b.hi IS NULL OR e.occurred_at < b.hi)
  ), page AS (
    SELECT u.* FROM unified u
    WHERE (p_cursor IS NULL OR (u.created_at, u.id) <
      (split_part(p_cursor, '|', 1)::timestamptz, split_part(p_cursor, '|', 2)))
      AND (p_actor_id IS NULL OR u.actor_id = p_actor_id)
      AND (p_action IS NULL OR u.action = p_action)
      AND (p_entity_type IS NULL OR u.entity_type = p_entity_type)
      AND (p_entity_id IS NULL OR u.entity_id = p_entity_id)
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  )
  SELECT p.id, p.actor_id, up.full_name, p.action, p.entity_type, p.entity_id,
    p.metadata, p.payload, p.created_at, p.source
  FROM page p LEFT JOIN user_profiles up ON up.id = p.actor_id
  ORDER BY p.created_at DESC, p.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_activity_logs_v1(text, integer, uuid, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_activity_logs_v1(text, integer, uuid, text, text, uuid, text, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
