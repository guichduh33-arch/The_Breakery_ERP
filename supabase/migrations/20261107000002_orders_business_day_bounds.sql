-- ADR-019 / ADR-025 : même journée métier locale pour les lignes et les compteurs.
-- Borne haute exclusive : inclure aussi les fractions de seconde avant minuit.

-- Corps live relevé le 2026-11-07 ; seul le nom et les bornes de date changent.
CREATE OR REPLACE FUNCTION public.get_orders_counters_v5(p_start text, p_end text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_start     TIMESTAMPTZ := p_start::date::timestamptz;
  v_end       TIMESTAMPTZ := (p_end::date + 1)::timestamptz;
  v_result    JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT o.id, o.status, o.total,
           -- RÉGLÉ (ADR-025 D5 amendée) : un paiement enregistré OU un statut
           -- qui porte l'argent — les règlements B2B n'écrivent jamais dans
           -- order_payments.
           (EXISTS (SELECT 1 FROM reporting_private.closed_order_payments_v1 op WHERE op.order_id = o.id)
             OR o.status IN ('paid', 'completed')) AS settled,
           rf.amt AS refund_amt
    FROM reporting_private.closed_pos_orders_v1 o
    LEFT JOIN customers    c  ON c.id  = o.customer_id
    LEFT JOIN reporting_private.closed_pos_sessions_v1 ps ON ps.id = o.session_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(r.total), 0) AS amt FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id
    ) rf ON TRUE
    WHERE public.can_view_order_v2(o.id) AND o.created_at >= v_start AND o.created_at < v_end
      AND (p_filters->>'order_type'     IS NULL OR o.order_type::text   = p_filters->>'order_type')
      AND (p_filters->>'customer_id'    IS NULL OR o.customer_id        = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'      IS NULL OR o.served_by          = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'total_min'      IS NULL OR o.total >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'      IS NULL OR o.total <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type'  IS NULL OR c.customer_type::text = p_filters->>'customer_type')
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM reporting_private.closed_order_payments_v1 op
        WHERE op.order_id = o.id AND op.method::text = p_filters->>'payment_method'
      ))
      AND (p_filters->>'terminal_id'    IS NULL OR ps.terminal_id       = (p_filters->>'terminal_id')::uuid)
      AND (p_filters->>'hour'           IS NULL OR EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Makassar') = (p_filters->>'hour')::int)
      -- Branches STRICTEMENT identiques à la famille get_orders_list (parité
      -- D2/D4) — le LATERAL rf ne sert que la cellule `refunded`.
      AND (
        p_filters->>'refund_status' IS NULL
        OR (
          p_filters->>'refund_status' = 'none'
            AND NOT EXISTS (SELECT 1 FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id)
        )
        OR (
          p_filters->>'refund_status' = 'partial'
            AND EXISTS (SELECT 1 FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id)
            AND COALESCE((SELECT SUM(r.total) FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id), 0) < o.total
        )
        OR (
          p_filters->>'refund_status' = 'full'
            AND COALESCE((SELECT SUM(r.total) FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id), 0) >= o.total
        )
      )
  ),
  by_status AS (
    SELECT f.status::text AS status,
           COUNT(*)::int  AS cnt,
           COALESCE(SUM(f.total), 0) AS amt
    FROM filtered f
    GROUP BY f.status
  )
  SELECT jsonb_build_object(
    'total', jsonb_build_object(
      'count',  COUNT(*)::int,
      'amount', COALESCE(SUM(f.total), 0)
    ),
    'paid', jsonb_build_object(
      'count',  (COUNT(*) FILTER (WHERE f.settled AND f.status::text <> 'voided'))::int,
      'amount', COALESCE(SUM(f.total) FILTER (WHERE f.settled AND f.status::text <> 'voided'), 0)
    ),
    'unpaid', jsonb_build_object(
      'count',  (COUNT(*) FILTER (WHERE NOT f.settled AND f.status::text <> 'voided'))::int,
      'amount', COALESCE(SUM(f.total) FILTER (WHERE NOT f.settled AND f.status::text <> 'voided'), 0)
    ),
    'refunded', jsonb_build_object(
      'count',  (COUNT(*) FILTER (WHERE f.refund_amt > 0))::int,
      'amount', COALESCE(SUM(f.refund_amt), 0)
    ),
    'by_status', (
      SELECT COALESCE(
        jsonb_object_agg(b.status, jsonb_build_object('count', b.cnt, 'amount', b.amt)),
        '{}'::jsonb
      )
      FROM by_status b
    )
  )
  INTO v_result
  FROM filtered f;

  RETURN v_result;
END;
$function$;

-- Corps live relevé le 2026-11-07 ; seul le nom et les bornes de date changent.
CREATE OR REPLACE FUNCTION public.get_orders_list_v7(p_start text, p_end text, p_filters jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 50, p_sort text DEFAULT 'created_at'::text, p_dir text DEFAULT 'desc'::text, p_cursor_val text DEFAULT NULL::text, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_clamp     INT  := LEAST(GREATEST(p_limit, 1), 200);
  v_start     TIMESTAMPTZ := p_start::date::timestamptz;
  v_end       TIMESTAMPTZ := (p_end::date + 1)::timestamptz;
  v_expr      TEXT;
  v_cast      TEXT;
  v_dir       TEXT;
  v_op        TEXT;
  v_sql       TEXT;
  v_lines     JSONB;
  v_next_val  TEXT;
  v_next_id   UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  CASE coalesce(p_sort, 'created_at')
    WHEN 'created_at' THEN v_expr := 'o.created_at';        v_cast := 'timestamptz';
    WHEN 'total'      THEN v_expr := 'o.total';             v_cast := 'numeric';
    WHEN 'status'     THEN v_expr := '(o.status)::text';     v_cast := 'text';
    WHEN 'order_type' THEN v_expr := '(o.order_type)::text'; v_cast := 'text';
    ELSE RAISE EXCEPTION 'invalid p_sort: %', p_sort USING ERRCODE = '22023';
  END CASE;
  CASE lower(coalesce(p_dir, 'desc'))
    WHEN 'desc' THEN v_dir := 'DESC'; v_op := '<';
    WHEN 'asc'  THEN v_dir := 'ASC';  v_op := '>';
    ELSE RAISE EXCEPTION 'invalid p_dir: %', p_dir USING ERRCODE = '22023';
  END CASE;

  v_sql := format($q$
  WITH filtered AS (
    SELECT
      o.id, o.order_number, o.order_type, o.status, o.total, o.created_at,
      o.customer_id, o.served_by, ps.terminal_id,
      c.customer_type, c.name AS customer_name,
      up.full_name AS served_by_name,
      (%1$s) AS _sort_val,
      CASE
        WHEN COALESCE(rsum.total, 0) = 0      THEN 'none'
        WHEN COALESCE(rsum.total, 0) >= o.total THEN 'full'
        ELSE 'partial'
      END AS refund_status,
      EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        WHERE oi.order_id = o.id
          AND oi.modifiers IS NOT NULL
          AND jsonb_array_length(oi.modifiers) > 0
      ) AS has_modifiers,
      (
        SELECT CASE WHEN COUNT(DISTINCT op.method) > 1 THEN 'mixed'
                    ELSE MIN(op.method)::text END
        FROM reporting_private.closed_order_payments_v1 op WHERE op.order_id = o.id
      ) AS payment_method_primary,
      (SELECT COUNT(*) FROM reporting_private.closed_order_items_v1 WHERE order_id = o.id)::INT AS items_count,
      ROW_NUMBER() OVER (ORDER BY %1$s %2$s, o.id %2$s) AS rn
    FROM reporting_private.closed_pos_orders_v1 o
    LEFT JOIN customers     c   ON c.id  = o.customer_id
    LEFT JOIN user_profiles up  ON up.id = o.served_by
    LEFT JOIN reporting_private.closed_pos_sessions_v1  ps  ON ps.id = o.session_id
    LEFT JOIN LATERAL (
      SELECT SUM(r.total) AS total FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE public.can_view_order_v2(o.id) AND o.created_at >= $1 AND o.created_at < $2
      AND (
        $5::text IS NULL
        OR ((%1$s), o.id) %3$s (($5)::%4$s, $6)
      )
      AND ($3->>'status'         IS NULL OR o.status::text       = $3->>'status')
      AND ($3->>'order_type'     IS NULL OR o.order_type::text   = $3->>'order_type')
      AND ($3->>'customer_id'    IS NULL OR o.customer_id        = ($3->>'customer_id')::uuid)
      AND ($3->>'served_by'      IS NULL OR o.served_by          = ($3->>'served_by')::uuid)
      AND ($3->>'total_min'      IS NULL OR o.total >= ($3->>'total_min')::numeric)
      AND ($3->>'total_max'      IS NULL OR o.total <= ($3->>'total_max')::numeric)
      AND ($3->>'customer_type'  IS NULL OR c.customer_type::text = $3->>'customer_type')
      AND ($3->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM reporting_private.closed_order_payments_v1 op
        WHERE op.order_id = o.id AND op.method::text = $3->>'payment_method'
      ))
      AND ($3->>'terminal_id'    IS NULL OR ps.terminal_id       = ($3->>'terminal_id')::uuid)
      AND ($3->>'hour'           IS NULL OR EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Makassar') = ($3->>'hour')::int)
      AND (
        $3->>'refund_status' IS NULL
        OR (
          $3->>'refund_status' = 'none'
            AND NOT EXISTS (SELECT 1 FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id)
        )
        OR (
          $3->>'refund_status' = 'partial'
            AND EXISTS (SELECT 1 FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id)
            AND COALESCE((SELECT SUM(r.total) FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id), 0) < o.total
        )
        OR (
          $3->>'refund_status' = 'full'
            AND COALESCE((SELECT SUM(r.total) FROM reporting_private.closed_refunds_v1 r WHERE r.order_id = o.id), 0) >= o.total
        )
      )
    ORDER BY %1$s %2$s, o.id %2$s
    LIMIT $4 + 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',                     f.id,
      'order_number',           f.order_number,
      'order_type',             f.order_type,
      'status',                 f.status,
      'total',                  f.total,
      'created_at',             f.created_at,
      'customer_id',            f.customer_id,
      'customer_name',          f.customer_name,
      'customer_type',          f.customer_type,
      'served_by',              f.served_by,
      'served_by_name',         f.served_by_name,
      'terminal_id',            f.terminal_id,
      'refund_status',          f.refund_status,
      'has_modifiers',          f.has_modifiers,
      'payment_method_primary', f.payment_method_primary,
      'items_count',            f.items_count
    ) ORDER BY f.rn) FILTER (WHERE f.rn <= $4), '[]'::jsonb),
    CASE WHEN COUNT(*) FILTER (WHERE f.rn > $4) > 0
         THEN (array_agg((f._sort_val)::text) FILTER (WHERE f.rn = $4))[1] END,
    CASE WHEN COUNT(*) FILTER (WHERE f.rn > $4) > 0
         THEN (array_agg(f.id) FILTER (WHERE f.rn = $4))[1] END
  FROM filtered f
  $q$, v_expr, v_dir, v_op, v_cast);

  EXECUTE v_sql
    INTO v_lines, v_next_val, v_next_id
    USING v_start, v_end, p_filters, v_clamp, p_cursor_val, p_cursor_id;

  RETURN jsonb_build_object(
    'lines', v_lines,
    'next_cursor_val', v_next_val,
    'next_cursor_id',  v_next_id,
    'sort', coalesce(p_sort, 'created_at'), 'dir', lower(coalesce(p_dir, 'desc'))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_orders_list_v7(text,text,jsonb,integer,text,text,text,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_orders_counters_v5(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_orders_list_v7(text,text,jsonb,integer,text,text,text,uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_orders_counters_v5(text,text,jsonb) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.get_orders_list_v6(text,text,jsonb,integer,text,text,text,uuid);
DROP FUNCTION public.get_orders_counters_v4(text,text,jsonb);
