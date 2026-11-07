-- Réduire chaque source avant la fusion et la projection JSON du journal.
-- Définition initiale issue de pg_get_functiondef sur V3 dev le 08/11/2026.
-- SECURITY INVOKER et politiques RLS conservés, sans mutation des événements.
CREATE INDEX IF NOT EXISTS audit_logs_activity_cursor_idx ON public.audit_logs
  (created_at DESC, ('audit:' || lpad(id::text, 20, '0')) DESC);
CREATE INDEX IF NOT EXISTS pos_events_activity_cursor_idx ON public.pos_events
  (occurred_at DESC, ('pos:' || id::text) DESC);

CREATE FUNCTION public.get_activity_logs_v2(p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_actor_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_date_start text DEFAULT NULL::text, p_date_end text DEFAULT NULL::text)
 RETURNS TABLE(id text, actor_id uuid, actor_name text, action text, entity_type text, entity_id uuid, metadata jsonb, payload jsonb, created_at timestamp with time zone, source text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
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
  ), audit_page AS MATERIALIZED (
    SELECT al.id, al.actor_id, al.action, al.entity_type, al.entity_id,
      al.metadata, al.payload, al.created_at
    FROM audit_logs al, bounds b
    WHERE al.created_at >= COALESCE(b.lo, '-infinity'::timestamptz)
      AND al.created_at <= COALESCE(b.hi, 'infinity'::timestamptz)
      AND (b.hi IS NULL OR al.created_at < b.hi)
      AND al.created_at <= COALESCE(split_part(p_cursor, '|', 1)::timestamptz, 'infinity'::timestamptz)
      AND (p_cursor IS NULL OR (al.created_at, 'audit:' || lpad(al.id::text, 20, '0')) <
        (split_part(p_cursor, '|', 1)::timestamptz, split_part(p_cursor, '|', 2)))
      AND (p_actor_id IS NULL OR al.actor_id = p_actor_id)
      AND (p_action IS NULL OR al.action = p_action)
      AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
      AND (p_entity_id IS NULL OR al.entity_id = p_entity_id)
    ORDER BY al.created_at DESC, 'audit:' || lpad(al.id::text, 20, '0') DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  ), pos_page AS MATERIALIZED (
    SELECT e.id, e.actor_id, e.event_type, e.order_id, e.device_id,
      e.order_number_snap, e.amount, e.reason, e.session_id, e.order_item_id,
      e.recorded_at, e.synced_by, e.payload, e.occurred_at
    FROM pos_events e, bounds b
    WHERE e.occurred_at >= COALESCE(b.lo, '-infinity'::timestamptz)
      AND e.occurred_at <= COALESCE(b.hi, 'infinity'::timestamptz)
      AND (b.hi IS NULL OR e.occurred_at < b.hi)
      AND e.occurred_at <= COALESCE(split_part(p_cursor, '|', 1)::timestamptz, 'infinity'::timestamptz)
      AND (p_cursor IS NULL OR (e.occurred_at, 'pos:' || e.id::text) <
        (split_part(p_cursor, '|', 1)::timestamptz, split_part(p_cursor, '|', 2)))
      AND (p_actor_id IS NULL OR e.actor_id = p_actor_id)
      AND (p_action IS NULL OR 'pos.' || e.event_type::text = p_action)
      AND (p_entity_type IS NULL OR
        CASE WHEN e.order_id IS NULL THEN 'pos_device' ELSE 'order' END = p_entity_type)
      AND (p_entity_id IS NULL OR COALESCE(e.order_id, e.device_id) = p_entity_id)
    ORDER BY e.occurred_at DESC, 'pos:' || e.id::text DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  ), unified AS (
    SELECT 'audit:' || lpad(al.id::text, 20, '0') AS id, al.actor_id,
      al.action, al.entity_type, al.entity_id, al.metadata, al.payload,
      al.created_at, 'audit'::text AS source
    FROM audit_page al
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
    FROM pos_page e
  ), page AS MATERIALIZED (
    SELECT u.* FROM unified u
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  )
  SELECT p.id, p.actor_id, up.full_name, p.action, p.entity_type, p.entity_id,
    p.metadata, p.payload, p.created_at, p.source
  FROM page p LEFT JOIN user_profiles up ON up.id = p.actor_id
  ORDER BY p.created_at DESC, p.id DESC;
$function$;

REVOKE ALL ON FUNCTION public.get_activity_logs_v2(text, integer, uuid, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_activity_logs_v2(text, integer, uuid, text, text, uuid, text, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.get_activity_logs_v1(text, integer, uuid, text, text, uuid, text, text);
