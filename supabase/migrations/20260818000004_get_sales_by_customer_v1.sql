-- 20260818000004_get_sales_by_customer_v1.sql
--
-- Rapport « Sales by Customer » (famille Sales) — qui compte, qui décroche.
-- Répond à : « qui sont mes clients qui comptent, et lesquels décrochent ? »
-- (conception validée par Mamat le 2026-08-16). Frontière assumée : les
-- segments RFM et cohortes vivent dans Marketing — ceci est la vue
-- TRANSACTIONNELLE d'une période.
--
-- IDENTIFIÉ = CAPTURE, PAS CLIENTÈLE. Une commande est « identifiée » quand un
-- client y est attaché ; l'anonyme est du comptoir sans carte, servi À CÔTÉ
-- (by_day.anonymous, summary.anonymous_*) pour que la part identifiée se lise
-- comme une performance de capture — jamais comme « des petits clients ».
--
-- PÉRIMÈTRE — ventes canoniques (get_sales_by_product_v1) : paid|completed,
-- non annulées, hors import historique, hors commandes contenant un produit de
-- test ; jour métier sur COALESCE(paid_at, created_at).
--
-- DÉCROCHAGE — un client avec ≥ p_churn_min_orders achats dans la fenêtre
-- précédente et AUCUN dans la courante. Le seuil est une CONSTANTE MÉTIER : il
-- vit dans packages/domain (CUSTOMER_CHURN_MIN_PREV_ORDERS) et transite par
-- l'argument — la RPC reste générique, le code reste la source du seuil.
--
-- « NOUVEAU » = premier achat canonique DE TOUS LES TEMPS dans la fenêtre
-- courante (arbitrage Mamat 2026-08-16) — pas « premier de la période ».
--
-- `p_customer_type` filtre les agrégats IDENTIFIÉS (by_customer, churned,
-- identified_*) ; l'anonyme n'a pas de type et reste entier — le comparer à un
-- sous-ensemble filtré serait un mensonge, la page l'annonce.
--
-- Un client soft-deleted garde ses ventes lisibles (l'histoire ne se réécrit
-- pas) ; by_day rend les seuls jours à ventes — le zéro-fill est client
-- (eachDay), comme partout dans le module.

CREATE OR REPLACE FUNCTION public.get_sales_by_customer_v1(
  p_start_date       date,
  p_end_date         date,
  p_customer_type    text DEFAULT NULL,
  p_churn_min_orders int  DEFAULT 2
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         text;
  v_start      date;
  v_end        date;
  v_prev_start date;
  v_prev_end   date;
  v_result     jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;
  IF p_customer_type IS NOT NULL AND p_customer_type NOT IN ('retail', 'b2b') THEN
    RAISE EXCEPTION 'invalid_customer_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_churn_min_orders IS NULL OR p_churn_min_orders < 1 THEN
    RAISE EXCEPTION 'invalid_churn_min_orders' USING ERRCODE = 'P0001';
  END IF;

  -- Clamp 366 jours (pattern S30/S40) : on rogne le DÉBUT.
  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id, o.total, o.customer_id,
      ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  -- Identifié = client attaché ; le filtre de type ne s'applique QU'À lui.
  ident AS (
    SELECT s.*, c.name, c.customer_type::text AS customer_type, c.loyalty_points
    FROM scoped s
    JOIN customers c ON c.id = s.customer_id
    WHERE (p_customer_type IS NULL OR c.customer_type::text = p_customer_type)
  ),
  ident_cur  AS (SELECT * FROM ident WHERE bd BETWEEN v_start AND v_end),
  ident_prev AS (SELECT * FROM ident WHERE bd < v_start),
  anon AS (
    SELECT * FROM scoped WHERE customer_id IS NULL
  ),
  per_customer_prev AS (
    SELECT customer_id, name, customer_type,
           COUNT(*) AS order_count, SUM(total) AS revenue, MAX(bd) AS last_order_date
    FROM ident_prev
    GROUP BY customer_id, name, customer_type
  ),
  per_customer AS (
    SELECT
      ic.customer_id,
      ic.name,
      ic.customer_type,
      ic.loyalty_points,
      COUNT(*)     AS order_count,
      SUM(ic.total) AS revenue,
      MAX(ic.bd)    AS last_order_date,
      -- « Nouveau » = aucun achat canonique AVANT la fenêtre, de tous les temps.
      NOT EXISTS (
        SELECT 1 FROM orders o2
        WHERE o2.customer_id = ic.customer_id
          AND o2.status IN ('paid', 'completed')
          AND o2.voided_at IS NULL
          AND o2.is_historical_import = false
          AND ((COALESCE(o2.paid_at, o2.created_at) AT TIME ZONE v_tz))::date < v_start
      ) AS is_new
    FROM ident_cur ic
    GROUP BY ic.customer_id, ic.name, ic.customer_type, ic.loyalty_points
  ),
  churned AS (
    SELECT pp.*
    FROM per_customer_prev pp
    WHERE pp.order_count >= p_churn_min_orders
      AND NOT EXISTS (SELECT 1 FROM ident_cur ic WHERE ic.customer_id = pp.customer_id)
  ),
  by_day AS (
    SELECT bd,
           COALESCE(SUM(total) FILTER (WHERE customer_id IS NOT NULL
             AND (p_customer_type IS NULL OR EXISTS (
               SELECT 1 FROM customers c WHERE c.id = customer_id
                 AND c.customer_type::text = p_customer_type))), 0) AS identified,
           COALESCE(SUM(total) FILTER (WHERE customer_id IS NULL), 0) AS anonymous
    FROM scoped
    WHERE bd BETWEEN v_start AND v_end
    GROUP BY bd
  ),
  tot AS (
    SELECT
      COALESCE((SELECT SUM(revenue) FROM per_customer), 0)                     AS identified_revenue,
      COALESCE((SELECT SUM(order_count) FROM per_customer), 0)                 AS identified_orders,
      COALESCE((SELECT COUNT(*) FROM per_customer), 0)                         AS customer_count,
      COALESCE((SELECT COUNT(*) FROM per_customer WHERE is_new), 0)            AS new_customer_count,
      COALESCE((SELECT SUM(revenue) FROM per_customer_prev), 0)                AS identified_revenue_prev,
      COALESCE((SELECT SUM(total) FROM anon WHERE bd BETWEEN v_start AND v_end), 0)           AS anonymous_revenue,
      COALESCE((SELECT COUNT(*)   FROM anon WHERE bd BETWEEN v_start AND v_end), 0)           AS anonymous_orders,
      COALESCE((SELECT SUM(total) FROM anon WHERE bd BETWEEN v_prev_start AND v_prev_end), 0) AS anonymous_revenue_prev
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'identified_revenue',      t.identified_revenue,
      'identified_revenue_prev', t.identified_revenue_prev,
      'identified_orders',       t.identified_orders,
      'anonymous_revenue',       t.anonymous_revenue,
      'anonymous_revenue_prev',  t.anonymous_revenue_prev,
      'anonymous_orders',        t.anonymous_orders,
      'customer_count',          t.customer_count,
      'new_customer_count',      t.new_customer_count
    ),
    'by_customer', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'customer_id',      pc.customer_id,
          'name',             pc.name,
          'customer_type',    pc.customer_type,
          'loyalty_points',   pc.loyalty_points,
          'order_count',      pc.order_count,
          'revenue',          pc.revenue,
          'last_order_date',  pc.last_order_date,
          'is_new',           pc.is_new,
          'revenue_prev',     pp.revenue,
          'order_count_prev', pp.order_count
        ) ORDER BY pc.revenue DESC, pc.name ASC
      )
      FROM per_customer pc
      LEFT JOIN per_customer_prev pp ON pp.customer_id = pc.customer_id
    ), '[]'::jsonb),
    'churned', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'customer_id',      ch.customer_id,
          'name',             ch.name,
          'customer_type',    ch.customer_type,
          'order_count_prev', ch.order_count,
          'revenue_prev',     ch.revenue,
          'last_order_date',  ch.last_order_date
        ) ORDER BY ch.revenue DESC, ch.name ASC
      ) FROM churned ch
    ), '[]'::jsonb),
    'by_day', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'date',       d.bd,
          'identified', d.identified,
          'anonymous',  d.anonymous
        ) ORDER BY d.bd ASC
      ) FROM by_day d
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_sales_by_customer_v1(date, date, text, int) IS
  'Ventes par client sur une plage de jours métier — CA identifié (client attaché) '
  'vs anonyme servi à côté (capture, pas clientèle), détail par client avec fenêtre '
  'précédente (delta), nouveaux (premier achat de tous les temps dans la fenêtre), '
  'décrochage (≥ p_churn_min_orders achats en fenêtre précédente, 0 en courante — '
  'seuil = constante packages/domain transmise en argument), by_day identifié/anonyme '
  '(zéro-fill client). Périmètre ventes canonique. p_customer_type filtre l''identifié '
  'seulement — l''anonyme n''a pas de type. Clamp 366 jours. Gate reports.sales.read.';

-- Defense-in-depth : anon hérite EXECUTE via PUBLIC, un REVOKE FROM anon seul
-- serait insuffisant.
REVOKE EXECUTE ON FUNCTION public.get_sales_by_customer_v1(date, date, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_customer_v1(date, date, text, int) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_sales_by_customer_v1(date, date, text, int) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
