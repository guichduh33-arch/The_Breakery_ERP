-- 20260710000116_net_revenue_exclude_full_void_refunds.sql
-- S64 T4 — fix I-1 (hérité S63, décision propriétaire 2026-07-06) : les voids
-- même-jour étaient comptés DEUX fois dans le revenu net. Lineage 20260704000018 :
-- un void pose status='voided' (la commande sort du brut) ET crée un refund
-- is_full_void=true (soustrait du net) → double pénalité de -T le jour même.
-- Fix : les soustractions de refunds n'incluent plus les refunds is_full_void
-- (colonne NOT NULL DEFAULT false → forme simple AND NOT r.is_full_void).
-- Les refunds PARTIELS (is_full_void=false) restent soustraits.
-- Corps repris du LIVE (pg_get_functiondef, DEV-S57-02). Signatures inchangées
-- → [types-noop]. Money-path non touchée (RPCs de lecture pure).

CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_today    DATE;
  v_kpis     JSONB;
  v_rev30    JSONB;
  v_by_type  JSONB;
  v_top      JSONB;
  v_hourly   JSONB;
  v_payments JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- ── KPIs du jour ────────────────────────────────────────────────────────
  WITH valid_today AS (
    SELECT o.id, o.total, o.customer_id
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
  )
  SELECT jsonb_build_object(
    'revenue_today',
      COALESCE((SELECT SUM(total) FROM valid_today), 0)
      - COALESCE((SELECT SUM(r.total) FROM refunds r
                   WHERE ((r.created_at AT TIME ZONE v_tz))::date = v_today
                     AND NOT r.is_full_void), 0),
    'orders_today',   (SELECT COUNT(*) FROM valid_today),
    'items_sold',
      COALESCE((SELECT SUM(oi.quantity) FROM order_items oi
                 JOIN valid_today vt ON vt.id = oi.order_id
                WHERE NOT oi.is_cancelled), 0),
    'avg_basket',
      CASE WHEN (SELECT COUNT(*) FROM valid_today) = 0 THEN 0
           ELSE ROUND(COALESCE((SELECT SUM(total) FROM valid_today), 0)
                      / (SELECT COUNT(*) FROM valid_today), 2) END,
    'customers_today',
      (SELECT COUNT(DISTINCT customer_id) FROM valid_today WHERE customer_id IS NOT NULL)
  ) INTO v_kpis;

  -- ── Tendance 30 j (série CONTINUE, jours vides à 0) ─────────────────────
  WITH days AS (
    SELECT d::date AS day
      FROM generate_series(v_today - 29, v_today, interval '1 day') d
  ),
  valid_orders AS (
    SELECT ((o.paid_at AT TIME ZONE v_tz))::date AS day, o.total
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_today - 29 AND v_today
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day, SUM(r.total) AS refund_total
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_today - 29 AND v_today
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  agg AS (
    SELECT d.day,
           COALESCE(SUM(vo.total), 0)::NUMERIC(14,2) AS gross,
           COUNT(vo.total)::INT                      AS order_count
      FROM days d
      LEFT JOIN valid_orders vo ON vo.day = d.day
     GROUP BY d.day
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date',        a.day,
           'net',         a.gross - COALESCE(dr.refund_total, 0),
           'order_count', a.order_count
         ) ORDER BY a.day), '[]'::jsonb)
    INTO v_rev30
    FROM agg a
    LEFT JOIN day_refunds dr ON dr.day = a.day;

  -- ── Revenu par type de commande (aujourd'hui) ───────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_type', t.order_type, 'gross', t.gross, 'order_count', t.cnt
         ) ORDER BY t.gross DESC), '[]'::jsonb)
    INTO v_by_type
    FROM (
      SELECT o.order_type::text AS order_type,
             SUM(o.total)::NUMERIC(14,2) AS gross,
             COUNT(*)::INT AS cnt
        FROM orders o
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
       GROUP BY o.order_type
    ) t;

  -- ── Top 5 produits du jour (par revenu, lignes annulées exclues) ────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id', p.product_id, 'name', p.name,
           'qty', p.qty, 'revenue', p.revenue
         ) ORDER BY p.revenue DESC), '[]'::jsonb)
    INTO v_top
    FROM (
      SELECT oi.product_id,
             MAX(oi.name_snapshot)              AS name,
             SUM(oi.quantity)::NUMERIC          AS qty,
             SUM(oi.line_total)::NUMERIC(14,2)  AS revenue
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
         AND NOT oi.is_cancelled
       GROUP BY oi.product_id
       ORDER BY revenue DESC
       LIMIT 5
    ) p;

  -- ── Ventes par heure locale (aujourd'hui ; heures sans vente omises) ────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'hour', h.hour, 'gross', h.gross, 'order_count', h.cnt
         ) ORDER BY h.hour), '[]'::jsonb)
    INTO v_hourly
    FROM (
      SELECT EXTRACT(HOUR FROM (o.paid_at AT TIME ZONE v_tz))::INT AS hour,
             SUM(o.total)::NUMERIC(14,2) AS gross,
             COUNT(*)::INT AS cnt
        FROM orders o
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND o.paid_at IS NOT NULL
         AND ((o.paid_at AT TIME ZONE v_tz))::date = v_today
       GROUP BY 1
    ) h;

  -- ── Moyens de paiement du jour (rattachés aux commandes valides) ────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'method', pm.method, 'amount', pm.amount, 'count', pm.cnt
         ) ORDER BY pm.amount DESC), '[]'::jsonb)
    INTO v_payments
    FROM (
      SELECT op.method::text AS method,
             SUM(op.amount)::NUMERIC(14,2) AS amount,
             COUNT(*)::INT AS cnt
        FROM order_payments op
        JOIN orders o ON o.id = op.order_id
       WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
         AND o.paid_at IS NOT NULL
         AND ((op.paid_at AT TIME ZONE v_tz))::date = v_today
       GROUP BY op.method
    ) pm;

  RETURN jsonb_build_object(
    'kpis',            v_kpis,
    'revenue_30d',     v_rev30,
    'revenue_by_type', v_by_type,
    'top_products',    v_top,
    'hourly_sales',    v_hourly,
    'payment_methods', v_payments,
    'generated_at',    now()
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_daily_sales_v1(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start   DATE;
  v_end     DATE;
  v_tz      TEXT;
  v_summary JSONB;
  v_by_day  JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
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

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH valid_orders AS (
    SELECT o.id,
           o.total,
           ((o.paid_at AT TIME ZONE v_tz))::date AS day
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  day_orders AS (
    SELECT vo.day,
           COUNT(*)::INT                AS order_count,
           SUM(vo.total)::NUMERIC(14,2) AS gross
      FROM valid_orders vo
     GROUP BY vo.day
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day,
           SUM(r.total) AS refund_total
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  days AS (
    SELECT COALESCE(o.day, r.day)                        AS day,
           COALESCE(o.order_count, 0)                    AS order_count,
           COALESCE(o.gross, 0)::NUMERIC(14,2)           AS gross,
           COALESCE(r.refund_total, 0)::NUMERIC(14,2)    AS refunds
      FROM day_orders o
      FULL OUTER JOIN day_refunds r ON r.day = o.day
  )
  SELECT
    jsonb_build_object(
      'total',        COALESCE(SUM(gross), 0),
      'order_count',  COALESCE(SUM(order_count), 0),
      'aov',          CASE WHEN COALESCE(SUM(order_count), 0) = 0 THEN 0
                           ELSE ROUND(SUM(gross) / SUM(order_count), 2) END,
      'refund_total', COALESCE(SUM(refunds), 0),
      'net',          COALESCE(SUM(gross), 0) - COALESCE(SUM(refunds), 0)
    ),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'date',        day,
        'order_count', order_count,
        'gross',       gross,
        'refunds',     refunds,
        'net',         gross - refunds,
        'aov',         CASE WHEN order_count = 0 THEN 0 ELSE ROUND(gross / order_count, 2) END
      ) ORDER BY day
    ), '[]'::jsonb)
  INTO v_summary, v_by_day
  FROM days;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', v_start, 'end', v_end),
    'summary', v_summary,
    'by_day',  v_by_day
  );
END;
$function$;

-- Trio S20 (idempotent — les fonctions existaient déjà avec ces ACLs)
REVOKE ALL ON FUNCTION public.get_dashboard_overview_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_overview_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v1() TO authenticated;

REVOKE ALL ON FUNCTION public.get_daily_sales_v1(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_daily_sales_v1(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_v1(text, text) TO authenticated;
