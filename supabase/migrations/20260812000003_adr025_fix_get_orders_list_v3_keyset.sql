-- Review PR #367 — correctif ADR-025 finding 3 (curseur keyset).
--
-- Le curseur v2 renvoyait le created_at de la ligne de PEEK puis filtrait
-- strictement created_at < cursor : la ligne de peek n'était jamais renvoyée,
-- une commande perdue par frontière de page. La v3 passe en keyset
-- (created_at, id) : le curseur est la DERNIÈRE ligne renvoyée, l'égalité de
-- timestamp se départage par id — aucune perte ni doublon. CREATE OR REPLACE :
-- rejeu idempotent (runbook DR, leçon ADR-013 D14).

CREATE OR REPLACE FUNCTION public.get_orders_list_v3(
  p_start     text,
  p_end       text,
  p_filters   jsonb DEFAULT '{}'::jsonb,
  p_limit     integer DEFAULT 50,
  p_cursor    timestamp with time zone DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_clamp     INT  := LEAST(GREATEST(p_limit, 1), 200);
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_lines     JSONB;
  v_next      TIMESTAMPTZ;
  v_next_id   UUID;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT
      o.id, o.order_number, o.order_type, o.status, o.total, o.created_at,
      o.customer_id, o.served_by, ps.terminal_id,
      c.customer_type, c.name AS customer_name,
      up.full_name AS served_by_name,
      CASE
        WHEN COALESCE(rsum.total, 0) = 0      THEN 'none'
        WHEN COALESCE(rsum.total, 0) >= o.total THEN 'full'
        ELSE 'partial'
      END AS refund_status,
      EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.modifiers IS NOT NULL
          AND jsonb_array_length(oi.modifiers) > 0
      ) AS has_modifiers,
      (
        SELECT CASE WHEN COUNT(DISTINCT op.method) > 1 THEN 'mixed'
                    ELSE MIN(op.method)::text END
        FROM order_payments op WHERE op.order_id = o.id
      ) AS payment_method_primary,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::INT AS items_count,
      ROW_NUMBER() OVER (ORDER BY o.created_at DESC, o.id DESC) AS rn
    FROM orders o
    LEFT JOIN customers     c   ON c.id  = o.customer_id
    LEFT JOIN user_profiles up  ON up.id = o.served_by
    LEFT JOIN pos_sessions  ps  ON ps.id = o.session_id
    LEFT JOIN LATERAL (
      SELECT SUM(r.total) AS total FROM refunds r WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE o.created_at BETWEEN v_start AND v_end
      -- Keyset (created_at, id) : le curseur est la DERNIÈRE ligne renvoyée ;
      -- l'égalité de timestamp se départage par id, aucune ligne perdue.
      AND (
        p_cursor IS NULL
        OR o.created_at < p_cursor
        OR (p_cursor_id IS NOT NULL AND o.created_at = p_cursor AND o.id < p_cursor_id)
      )
      AND (p_filters->>'status'         IS NULL OR o.status::text       = p_filters->>'status')
      AND (p_filters->>'order_type'     IS NULL OR o.order_type::text   = p_filters->>'order_type')
      AND (p_filters->>'customer_id'    IS NULL OR o.customer_id        = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'      IS NULL OR o.served_by          = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'total_min'      IS NULL OR o.total >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'      IS NULL OR o.total <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type'  IS NULL OR c.customer_type::text = p_filters->>'customer_type')
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM order_payments op
        WHERE op.order_id = o.id AND op.method::text = p_filters->>'payment_method'
      ))
      AND (p_filters->>'terminal_id'    IS NULL OR ps.terminal_id       = (p_filters->>'terminal_id')::uuid)
      AND (p_filters->>'hour'           IS NULL OR EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Makassar') = (p_filters->>'hour')::int)
      AND (
        p_filters->>'refund_status' IS NULL
        OR (
          p_filters->>'refund_status' = 'none'
            AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
        )
        OR (
          p_filters->>'refund_status' = 'partial'
            AND EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) < o.total
        )
        OR (
          p_filters->>'refund_status' = 'full'
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) >= o.total
        )
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT v_clamp + 1
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
    ) ORDER BY f.created_at DESC, f.id DESC) FILTER (WHERE f.rn <= v_clamp), '[]'::jsonb),
    CASE WHEN COUNT(*) FILTER (WHERE f.rn > v_clamp) > 0
         THEN MIN(f.created_at) FILTER (WHERE f.rn = v_clamp) END,
    CASE WHEN COUNT(*) FILTER (WHERE f.rn > v_clamp) > 0
         THEN (array_agg(f.id) FILTER (WHERE f.rn = v_clamp))[1] END
  INTO v_lines, v_next, v_next_id
  FROM filtered f;

  RETURN jsonb_build_object('lines', v_lines, 'next_cursor', v_next, 'next_cursor_id', v_next_id);
END;
$function$;

DROP FUNCTION IF EXISTS public.get_orders_list_v2(text, text, jsonb, integer, timestamp with time zone);

REVOKE EXECUTE ON FUNCTION public.get_orders_list_v3(text, text, jsonb, integer, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_list_v3(text, text, jsonb, integer, timestamp with time zone, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_orders_list_v3(text, text, jsonb, integer, timestamp with time zone, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_orders_list_v3(text, text, jsonb, integer, timestamp with time zone, uuid) IS
  'BO orders list v3 : keyset (created_at, id) — le curseur est la dernière ligne renvoyée, plus aucune commande perdue aux frontières de page (review PR #367, finding 3). Filtres serveur inchangés depuis la v2.';
