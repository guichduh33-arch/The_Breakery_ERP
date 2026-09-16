-- Reports : curseur total et délai pondéré par les réceptions mesurées.
-- Corps repris des définitions live le 2026-09-12 ; gates et RLS conservés.

CREATE OR REPLACE FUNCTION public.get_audit_logs_v4(p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_actor_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_date_start text DEFAULT NULL::text, p_date_end text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, actor_id uuid, action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  ),
  bounds AS (
    SELECT
      CASE WHEN p_date_start IS NULL THEN NULL
           ELSE (p_date_start::date + TIME '00:00') AT TIME ZONE (SELECT tz FROM cfg)
      END AS lo,
      CASE WHEN p_date_end IS NULL THEN NULL
           ELSE ((p_date_end::date + 1) + TIME '00:00') AT TIME ZONE (SELECT tz FROM cfg)
      END AS hi
  )
  SELECT
    al.id,
    al.actor_id,
    al.action,
    al.entity_type,
    al.entity_id,
    al.metadata,
    al.created_at
  FROM audit_logs al, bounds b
  WHERE (p_cursor IS NULL OR (al.created_at, al.id) < (split_part(p_cursor, '|', 1)::timestamptz, split_part(p_cursor, '|', 2)::bigint))
    AND (p_actor_id IS NULL OR al.actor_id = p_actor_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR al.entity_id = p_entity_id)
    AND (b.lo IS NULL OR al.created_at >= b.lo)
    AND (b.hi IS NULL OR al.created_at <  b.hi)
  ORDER BY al.created_at DESC, al.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$function$
;

CREATE OR REPLACE FUNCTION public.get_purchase_by_supplier_v2(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start       DATE;
  v_end         DATE;
  v_by_supplier JSONB;
  v_global_total NUMERIC(14,2);
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  -- Compute global total (non-cancelled, non-draft) for share_pct denominator
  SELECT COALESCE(SUM(po.total_amount), 0)
  INTO v_global_total
  FROM purchase_orders po
  WHERE po.status NOT IN ('draft', 'cancelled')
    AND po.deleted_at IS NULL
    AND po.order_date BETWEEN v_start AND v_end;

  WITH agg AS (
    SELECT
      s.id                                                              AS supplier_id,
      s.name                                                            AS supplier_name,
      COUNT(*)::INT                                                     AS po_count,
      SUM(po.total_amount) FILTER (WHERE po.status NOT IN ('draft','cancelled'))::NUMERIC(14,2)
                                                                        AS total,
      SUM(1) FILTER (WHERE po.status = 'received')::INT                AS received_count,
      SUM(1) FILTER (WHERE po.status = 'cancelled')::INT               AS cancelled_count,
      ROUND(
        AVG(
          EXTRACT(DAY FROM (po.received_date::timestamptz - po.order_date::timestamptz))
        ) FILTER (WHERE po.status = 'received' AND po.received_date IS NOT NULL),
        1
      )                                                                 AS avg_lead_days,
      COALESCE(SUM(EXTRACT(DAY FROM (po.received_date::timestamptz - po.order_date::timestamptz)))
        FILTER (WHERE po.status = 'received' AND po.received_date IS NOT NULL), 0) AS lead_days_total,
      COUNT(*) FILTER (WHERE po.status = 'received' AND po.received_date IS NOT NULL) AS lead_sample_count
    FROM purchase_orders po
    JOIN suppliers s ON s.id = po.supplier_id
    WHERE po.status != 'draft'
      AND po.deleted_at IS NULL
      AND po.order_date BETWEEN v_start AND v_end
    GROUP BY s.id, s.name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'supplier_id',       supplier_id,
      'supplier_name',     supplier_name,
      'po_count',          po_count,
      'total',             COALESCE(total, 0),
      'received_count',    COALESCE(received_count, 0),
      'cancelled_count',   COALESCE(cancelled_count, 0),
      'avg_lead_days',     avg_lead_days,
      'lead_days_total',   lead_days_total,
      'lead_sample_count', lead_sample_count,
      'share_pct',         CASE WHEN v_global_total = 0 THEN 0
                                ELSE ROUND((COALESCE(total, 0) / v_global_total) * 100, 2)
                           END
    ) ORDER BY COALESCE(total, 0) DESC
  ), '[]'::jsonb)
  INTO v_by_supplier
  FROM agg;

  RETURN jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'by_supplier',  v_by_supplier
  );
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.get_audit_logs_v4(text, integer, uuid, text, text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_audit_logs_v4(text, integer, uuid, text, text, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_audit_logs_v4(text, integer, uuid, text, text, uuid, text, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.get_purchase_by_supplier_v2(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_purchase_by_supplier_v2(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_purchase_by_supplier_v2(text, text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.get_audit_logs_v3(timestamptz, integer, uuid, text, text, uuid, text, text);
DROP FUNCTION public.get_purchase_by_supplier_v1(text, text);
