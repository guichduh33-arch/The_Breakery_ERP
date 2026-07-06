-- 20260710000114_fix_dashboard_overview_paid_at_guard.sql
-- S63 — fix revue Task 1 : le bloc payment_methods de get_dashboard_overview_v1
-- omettait AND o.paid_at IS NOT NULL (présent dans les 5 autres sections).
-- Sans ce prédicat, une commande hypothétique paid/completed sans paid_at
-- fuirait dans payment_methods tout en étant exclue du reste de l'enveloppe
-- (snapshot interne incohérent). In-place : corps complet re-créé, signature
-- inchangée, seule la ligne du prédicat ajoutée. Le bucketing reste op.paid_at
-- (date du PAIEMENT — spec §3.3 « paiements du jour local »).

CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v1()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
                   WHERE ((r.created_at AT TIME ZONE v_tz))::date = v_today), 0),
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
$$;

COMMENT ON FUNCTION public.get_dashboard_overview_v1() IS
  'S63 — BO home dashboard aggregate (today KPIs net-of-refunds, 30d trend, by-type, top products, hourly, payment methods). Read-only. Gate reports.read.';

REVOKE ALL ON FUNCTION public.get_dashboard_overview_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_dashboard_overview_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v1() TO authenticated;
