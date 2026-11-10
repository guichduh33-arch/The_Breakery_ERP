-- 20261110000001_sales_created_paid_table.sql
-- S3-21 (demande du propriétaire, 2026-11-10) : montrer sur les ventes l'heure
-- de création, l'heure de paiement et le numéro de table.
--
-- Trois familles bumpées, corps repris du live (pg_get_functiondef, 2026-11-10) :
--   * get_orders_counters v5 -> v6 : même filtre `table_number` que la liste
--     (parité des filtres liste / compteurs). Réponse inchangée.
--   * get_orders_list v7 -> v8 : la réponse porte en plus `paid_at` et
--     `table_number` (`created_at` y était déjà) ; nouveau filtre
--     `p_filters->>'table_number'` (égalité stricte). Signature inchangée.
--   * get_product_sales_lines v5 -> v6 : chaque ligne porte en plus
--     `created_at` (création de la commande), `paid_at` et `table_number`.
--     `sold_at` reste la date de reconnaissance et reste la clé du curseur.
--
-- Aucun changement de périmètre, de gate, de tri ni de total : seuls des champs
-- et un filtre optionnel s'ajoutent.

CREATE OR REPLACE FUNCTION public.get_orders_list_v8(
  p_start text,
  p_end text,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 50,
  p_sort text DEFAULT 'created_at'::text,
  p_dir text DEFAULT 'desc'::text,
  p_cursor_val text DEFAULT NULL::text,
  p_cursor_id uuid DEFAULT NULL::uuid
)
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
      o.paid_at, o.table_number,
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
      AND ($3->>'table_number'   IS NULL OR o.table_number       = $3->>'table_number')
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
      'paid_at',                f.paid_at,
      'table_number',           f.table_number,
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

COMMENT ON FUNCTION public.get_orders_list_v8(text,text,jsonb,integer,text,text,text,uuid) IS
  'S3-21: v7 + paid_at, table_number in each line, and optional p_filters.table_number (exact match). Gate orders.read.';

REVOKE ALL ON FUNCTION public.get_orders_list_v8(text,text,jsonb,integer,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_list_v8(text,text,jsonb,integer,text,text,text,uuid) TO authenticated, service_role;
DROP FUNCTION public.get_orders_list_v7(text,text,jsonb,integer,text,text,text,uuid);

CREATE OR REPLACE FUNCTION public.get_product_sales_lines_v6(
  p_product_id uuid,
  p_start_date date,
  p_end_date date,
  p_limit integer DEFAULT 100,
  p_cursor text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz        text;
  v_start     date;
  v_end       date;
  v_limit     integer;
  v_cur_ts    timestamptz := NULL;
  v_cur_id    uuid        := NULL;
  v_sep       integer;
  v_rows      jsonb;
  v_totals    jsonb;
  v_count     integer;
  v_next      text        := NULL;
  v_result    jsonb;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT (has_permission(auth.uid(), 'reports.sales.read')
    OR has_permission(auth.uid(), 'reports.product_sales.read')) THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read or reports.product_sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    v_sep := position('|' IN p_cursor);
    IF v_sep < 2 THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_cur_ts := substring(p_cursor FROM 1 FOR v_sep - 1)::timestamptz;
      v_cur_id := substring(p_cursor FROM v_sep + 1)::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'P0001';
    END;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.served_by,
      o.created_at                       AS order_created_at,
      o.paid_at,
      o.table_number,
      (o.order_type = 'b2b')             AS is_b2b,
      COALESCE(o.recognized_at, o.created_at)  AS sold_at
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT
      oi.id,
      s.sold_at,
      s.order_created_at,
      s.paid_at,
      s.table_number,
      s.id            AS order_id,
      s.order_number,
      s.customer_id,
      cu.name         AS customer_name,
      s.is_b2b,
      up.full_name    AS served_by_name,
      oi.name_snapshot,
      oi.quantity,
      oi.unit_price,
      COALESCE(oi.modifiers_total, 0)  AS modifiers_total,
      COALESCE(oi.discount_amount, 0)  AS discount_amount,
      oi.discount_reason,
      oi.line_total
    FROM reporting_private.closed_order_items_v1 oi
    JOIN scoped s ON s.id = oi.order_id
    LEFT JOIN customers     cu ON cu.id = s.customer_id
    LEFT JOIN user_profiles up ON up.id = s.served_by
    WHERE oi.product_id    = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  page AS (
    SELECT *
    FROM lines
    WHERE v_cur_ts IS NULL
       OR (sold_at, id) < (v_cur_ts, v_cur_id)
    ORDER BY sold_at DESC, id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',              pg.id,
        'sold_at',         pg.sold_at,
        'created_at',      pg.order_created_at,
        'paid_at',         pg.paid_at,
        'table_number',    pg.table_number,
        'order_id',        pg.order_id,
        'order_number',    pg.order_number,
        'customer_id',     pg.customer_id,
        'customer_name',   pg.customer_name,
        'channel',         CASE WHEN pg.is_b2b THEN 'b2b' ELSE 'counter' END,
        'served_by_name',  pg.served_by_name,
        'name_snapshot',   pg.name_snapshot,
        'quantity',        pg.quantity,
        'unit_price',      pg.unit_price,
        'modifiers_total', pg.modifiers_total,
        'discount_amount', pg.discount_amount,
        'discount_reason', pg.discount_reason,
        'line_total',      pg.line_total
      ) ORDER BY pg.sold_at DESC, pg.id DESC
    ), '[]'::jsonb),
    COUNT(*)::int
  INTO v_rows, v_count
  FROM page pg;

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b') AS is_b2b
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT oi.order_id, oi.quantity, oi.line_total,
           COALESCE(oi.discount_amount, 0) AS discount_amount, s.is_b2b
    FROM reporting_private.closed_order_items_v1 oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.product_id    = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  )
  SELECT jsonb_build_object(
    'lines',         COUNT(*),
    'orders',        COUNT(DISTINCT order_id),
    'qty',           COALESCE(SUM(quantity), 0),
    'revenue',       COALESCE(SUM(line_total), 0),
    'discount',      COALESCE(SUM(discount_amount), 0),
    'counter_qty',   COALESCE(SUM(quantity) FILTER (WHERE NOT is_b2b), 0),
    'b2b_qty',       COALESCE(SUM(quantity) FILTER (WHERE is_b2b), 0)
  )
  INTO v_totals
  FROM lines;

  IF v_count = v_limit THEN
    SELECT (r->>'sold_at') || '|' || (r->>'id')
      INTO v_next
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(r, ord)
     WHERE ord = v_count;
  END IF;

  v_result := jsonb_build_object(
    'product_id',   p_product_id,
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'lines',        v_rows,
    'totals',       v_totals,
    'next_cursor',  v_next,
    'has_more',     v_next IS NOT NULL
  );

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_product_sales_lines_v6(uuid, date, date, integer, text) IS
  'S3-21: v5 + created_at (order creation), paid_at, table_number in each line. sold_at stays the recognition date and the cursor key.';

REVOKE EXECUTE ON FUNCTION public.get_product_sales_lines_v6(uuid, date, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_sales_lines_v6(uuid, date, date, integer, text) TO authenticated, service_role;
DROP FUNCTION public.get_product_sales_lines_v5(uuid, date, date, integer, text);

-- Parité des filtres liste / compteurs (ADR-025 D2/D4) : le filtre par table
-- ajouté à la liste doit exister à l'identique dans les compteurs, sinon les
-- cartes de statut ne décrivent plus les lignes affichées.
CREATE OR REPLACE FUNCTION public.get_orders_counters_v6(
  p_start text,
  p_end text,
  p_filters jsonb DEFAULT '{}'::jsonb
)
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
      AND (p_filters->>'table_number'   IS NULL OR o.table_number       = p_filters->>'table_number')
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

COMMENT ON FUNCTION public.get_orders_counters_v6(text,text,jsonb) IS
  'S3-21: v5 + optional p_filters.table_number, identical to get_orders_list (filter parity). Gate orders.read.';

REVOKE ALL ON FUNCTION public.get_orders_counters_v6(text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_orders_counters_v6(text,text,jsonb) TO authenticated, service_role;
DROP FUNCTION public.get_orders_counters_v5(text,text,jsonb);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
