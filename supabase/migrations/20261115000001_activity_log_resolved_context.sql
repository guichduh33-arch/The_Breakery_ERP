-- Le journal commun rend le contexte qu'il sait déjà retrouver : rôle du compte,
-- commande, terminal, produit. Rien n'est écrit : les traces restent telles quelles,
-- la lecture seule change. Les dix colonnes historiques gardent nom, ordre et contenu ;
-- les nouvelles s'ajoutent à droite.
-- Corps repris de pg_get_functiondef sur V3 dev le 15/11/2026.
--
-- Ce que la lecture résout, et ses limites assumées :
--   actor_role   rôle ACTUEL du compte (aucun rôle n'est stocké dans l'événement).
--   order_id     identifiant porté par la trace elle-même, jamais déduit du numéro :
--                la numérotation repart chaque jour, un numéro seul désigne plusieurs commandes.
--   order_number numéro de la trace, sinon celui de la commande retrouvée par identifiant.
--   device_*     terminal des gestes POS, son libellé et son compteur d'ordre local.
--   product_*    produit de la trace, sinon celui du mouvement de stock visé.
-- SECURITY INVOKER : chaque jointure obéit aux droits de l'appelant. Une commande, un
-- mouvement ou un produit qu'il ne peut pas lire laisse la case vide, sans masquer la ligne.
CREATE FUNCTION public.get_activity_logs_v4(p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_actor_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_date_start text DEFAULT NULL::text, p_date_end text DEFAULT NULL::text)
 RETURNS TABLE(id text, actor_id uuid, actor_name text, action text, entity_type text, entity_id uuid, metadata jsonb, payload jsonb, created_at timestamp with time zone, source text,
   actor_role text, order_id uuid, order_number text, device_id uuid, device_label text, device_seq bigint, product_id uuid, product_name text)
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_tz text;
  v_lo timestamptz;
  v_hi timestamptz;
  -- Une clé JSON n'est convertie en identifiant que si elle en a la forme :
  -- une valeur libre ne doit jamais faire échouer la lecture du journal.
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
BEGIN
  SELECT COALESCE(MAX(bc.timezone), 'Asia/Makassar') INTO v_tz
  FROM public.business_config bc WHERE bc.id = 1;
  v_lo := CASE WHEN p_date_start IS NULL THEN NULL
    ELSE p_date_start::date::timestamp AT TIME ZONE v_tz END;
  v_hi := CASE WHEN p_date_end IS NULL THEN NULL
    ELSE (p_date_end::date + 1)::timestamp AT TIME ZONE v_tz END;
  RETURN QUERY
WITH audit_page AS MATERIALIZED (
    SELECT al.id, al.actor_id, al.action, al.entity_type, al.entity_id,
      al.metadata, al.payload, al.created_at
    FROM audit_logs al
    WHERE al.created_at >= COALESCE(v_lo, '-infinity'::timestamptz)
      AND al.created_at <= COALESCE(v_hi, 'infinity'::timestamptz)
      AND (v_hi IS NULL OR al.created_at < v_hi)
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
    SELECT e.id, e.actor_id, e.event_type, e.order_id, e.device_id, e.device_seq,
      e.order_number_snap, e.amount, e.reason, e.session_id, e.order_item_id,
      e.recorded_at, e.synced_by, e.payload, e.occurred_at
    FROM pos_events e
    WHERE e.occurred_at >= COALESCE(v_lo, '-infinity'::timestamptz)
      AND e.occurred_at <= COALESCE(v_hi, 'infinity'::timestamptz)
      AND (v_hi IS NULL OR e.occurred_at < v_hi)
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
      al.created_at, 'audit'::text AS source,
      CASE WHEN al.entity_type IN ('order', 'orders') THEN al.entity_id
        WHEN (al.metadata->>'order_id') ~ v_uuid THEN (al.metadata->>'order_id')::uuid END AS order_ref,
      NULLIF(al.metadata->>'order_number', '') AS order_num,
      NULL::uuid AS device_ref, NULL::bigint AS device_seq,
      CASE WHEN al.entity_type IN ('product', 'products') THEN al.entity_id
        WHEN (al.metadata->>'product_id') ~ v_uuid THEN (al.metadata->>'product_id')::uuid END AS product_ref,
      CASE WHEN al.entity_type = 'stock_movements' THEN al.entity_id END AS movement_ref
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
      )), e.payload, e.occurred_at, 'pos'::text,
      e.order_id, e.order_number_snap, e.device_id, e.device_seq,
      CASE WHEN (e.payload->>'product_id') ~ v_uuid THEN (e.payload->>'product_id')::uuid END,
      NULL::uuid
    FROM pos_page e
  ), page AS MATERIALIZED (
    SELECT u.* FROM unified u
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  )
  -- Jointures par clé primaire sur la page finale seulement : 200 lignes au plus.
  SELECT p.id, p.actor_id, up.full_name, p.action, p.entity_type, p.entity_id,
    p.metadata, p.payload, p.created_at, p.source,
    up.role_code, p.order_ref, COALESCE(p.order_num, o.order_number),
    p.device_ref, d.label, p.device_seq,
    COALESCE(p.product_ref, sm.product_id), pr.name
  FROM page p
  LEFT JOIN user_profiles up ON up.id = p.actor_id
  LEFT JOIN orders o ON o.id = p.order_ref AND p.order_num IS NULL
  LEFT JOIN pos_devices d ON d.id = p.device_ref
  LEFT JOIN stock_movements sm ON sm.id = p.movement_ref AND p.product_ref IS NULL
  LEFT JOIN products pr ON pr.id = COALESCE(p.product_ref, sm.product_id)
  ORDER BY p.created_at DESC, p.id DESC;

END;
$function$;

REVOKE ALL ON FUNCTION public.get_activity_logs_v4(text, integer, uuid, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_activity_logs_v4(text, integer, uuid, text, text, uuid, text, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.get_activity_logs_v3(text, integer, uuid, text, text, uuid, text, text);
