-- 20260802000001_gate_four_ungated_report_rpcs.sql
--
-- Audit Reports 2026-08-01, lot C / decision D1.
--
-- Quatre RPC de reporting etaient SECURITY INVOKER, sans gate has_permission,
-- et EXECUTE accorde a `authenticated`. Elles ne s'appuyaient donc que sur la
-- RLS des tables lues — or `orders.auth_read` et `journal_entry_lines.auth_read`
-- ont pour predicat `is_authenticated()`, qui ne filtre rien.
--
-- Mesure faite en incarnant le CAISSIER de seed (role authenticated, RLS
-- active) avant ce correctif :
--   get_sales_by_staff_v2     -> 3 lignes, CA par collegue, 13 644 200 IDR
--   get_cash_flow_v1          -> cash_end = -951 621,73 (tresorerie societe)
--   get_sales_by_category_v2  -> 10 lignes
--   get_basket_analysis_v2    -> 10 paires
-- (get_audit_logs_v3, egalement sans gate, est bien protegee par la policy
--  admin_read de audit_logs : 0 ligne pour un caissier ET pour un manager.
--  Elle n'est donc pas dans ce lot.)
--
-- Incoherence qui a tranche le debat : l'export PDF de `basket` est deja gate
-- sur reports.sales.read cote edge function, donc le chemin d'EXTRACTION etait
-- plus strict que le chemin de LECTURE.
--
-- Les corps sont repris verbatim de pg_get_functiondef ; les trois fonctions
-- LANGUAGE sql passent en plpgsql pour porter le gate (meme conversion que le
-- bump v1 -> v2 de get_sales_by_hour en S50 W1.2). Aucune logique metier n'est
-- modifiee.
--
-- ERRCODE 42501 : convention deja etablie dans toute la famille reports.* — le
-- hook useCashierVariance teste explicitement `error.code === '42501'`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_sales_by_category_v3  (gate reports.sales.read)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_category_v3(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS TABLE(category_id UUID, category_name TEXT, total NUMERIC, qty NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  )
  SELECT
    c.id                                   AS category_id,
    c.name                                 AS category_name,
    COALESCE(SUM(oi.line_total), 0)::DECIMAL(14,2) AS total,
    COALESCE(SUM(oi.quantity),  0)::DECIMAL(12,3)  AS qty
  FROM order_items oi
  JOIN orders     o ON o.id = oi.order_id
  JOIN products   p ON p.id = oi.product_id
  JOIN categories c ON c.id = p.category_id
  WHERE o.status IN ('paid', 'completed')
    AND o.paid_at IS NOT NULL
    AND o.voided_at IS NULL
    AND oi.is_cancelled = false
    AND oi.is_promo_gift = false
    AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY c.id, c.name
  ORDER BY total DESC;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_sales_by_staff_v3  (gate reports.sales.read)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_by_staff_v3(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS TABLE(staff_id UUID, staff_name TEXT, total NUMERIC, order_count INTEGER, avg_basket NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  )
  SELECT
    o.served_by                            AS staff_id,
    up.full_name                           AS staff_name,
    SUM(o.total)::DECIMAL(14,2)            AS total,
    COUNT(*)::INT                          AS order_count,
    (SUM(o.total) / NULLIF(COUNT(*), 0))::DECIMAL(14,2) AS avg_basket
  FROM orders o
  JOIN user_profiles up ON up.id = o.served_by
  WHERE o.status IN ('paid', 'completed')
    AND o.paid_at IS NOT NULL
    AND o.voided_at IS NULL
    AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY o.served_by, up.full_name
  ORDER BY total DESC;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_basket_analysis_v3  (gate reports.sales.read)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_basket_analysis_v3(
  p_date_start DATE,
  p_date_end   DATE,
  p_top_n      INTEGER DEFAULT 10
)
RETURNS TABLE(
  product_id_a UUID, product_a_name TEXT,
  product_id_b UUID, product_b_name TEXT,
  co_occurrence_count INTEGER,
  support_a NUMERIC, support_b NUMERIC, support_pair NUMERIC,
  confidence NUMERIC, lift NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  ),
  filtered_orders AS (
    SELECT o.id
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.paid_at IS NOT NULL
      AND o.voided_at IS NULL
      AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg))::date
            BETWEEN p_date_start AND p_date_end)
  ),
  total_orders AS (
    SELECT GREATEST(COUNT(*), 1)::DECIMAL AS n FROM filtered_orders
  ),
  order_products AS (
    SELECT DISTINCT
      oi.order_id,
      oi.product_id
    FROM order_items oi
    JOIN filtered_orders fo ON fo.id = oi.order_id
    WHERE oi.product_id IS NOT NULL
      AND oi.is_cancelled IS NOT TRUE
      AND oi.is_promo_gift IS NOT TRUE
  ),
  product_support AS (
    SELECT
      op.product_id,
      COUNT(DISTINCT op.order_id)::INT AS order_count
    FROM order_products op
    GROUP BY op.product_id
  ),
  pairs AS (
    SELECT
      a.product_id AS product_id_a,
      b.product_id AS product_id_b,
      COUNT(DISTINCT a.order_id)::INT AS co_count
    FROM order_products a
    JOIN order_products b
      ON a.order_id = b.order_id
     AND a.product_id < b.product_id
    GROUP BY a.product_id, b.product_id
  )
  SELECT
    p.product_id_a,
    pa.name AS product_a_name,
    p.product_id_b,
    pb.name AS product_b_name,
    p.co_count AS co_occurrence_count,
    (sa.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_a,
    (sb.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_b,
    (p.co_count    / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_pair,
    CASE
      WHEN sa.order_count = 0 THEN 0::DECIMAL(8,6)
      ELSE (p.co_count::DECIMAL / sa.order_count)::DECIMAL(8,6)
    END AS confidence,
    CASE
      WHEN sa.order_count = 0 OR sb.order_count = 0 THEN 0::DECIMAL(10,4)
      ELSE (
        (p.co_count::DECIMAL * (SELECT n FROM total_orders))
        / NULLIF(sa.order_count::DECIMAL * sb.order_count, 0)
      )::DECIMAL(10,4)
    END AS lift
  FROM pairs p
  JOIN product_support sa ON sa.product_id = p.product_id_a
  JOIN product_support sb ON sb.product_id = p.product_id_b
  JOIN products pa
    ON pa.id = p.product_id_a
   AND pa.deleted_at IS NULL
  JOIN products pb
    ON pb.id = p.product_id_b
   AND pb.deleted_at IS NULL
  ORDER BY lift DESC NULLS LAST, co_occurrence_count DESC
  LIMIT GREATEST(p_top_n, 1);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_cash_flow_v2  (gate reports.financial.read)
--
-- Corps identique a v1. NOTE : v1 posait `v_net_change := v_operating_total`,
-- donc « net change in cash » n'est jamais rapproche de cash_end - cash_start,
-- et investing/financing sont des zeros codes en dur. C'est la cause du constat
-- R-04. L'arbitrage a ete de ne PAS toucher au calcul dans ce lot (affichage
-- seul cote page) : le comportement est donc conserve tel quel ici.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cash_flow_v2(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_net_profit       NUMERIC(14,2) := 0;
  v_revenue          NUMERIC(14,2) := 0;
  v_cogs             NUMERIC(14,2) := 0;
  v_opex             NUMERIC(14,2) := 0;
  v_ar_start         NUMERIC(14,2) := 0;
  v_ar_end           NUMERIC(14,2) := 0;
  v_ap_start         NUMERIC(14,2) := 0;
  v_ap_end           NUMERIC(14,2) := 0;
  v_inv_start        NUMERIC(14,2) := 0;
  v_inv_end          NUMERIC(14,2) := 0;
  v_cash_start       NUMERIC(14,2) := 0;
  v_cash_end         NUMERIC(14,2) := 0;
  v_delta_ar         NUMERIC(14,2) := 0;
  v_delta_ap         NUMERIC(14,2) := 0;
  v_delta_inv        NUMERIC(14,2) := 0;
  v_operating_total  NUMERIC(14,2) := 0;
  v_net_change       NUMERIC(14,2) := 0;
  v_prior_end DATE;
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_cash_flow_v2: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_cash_flow_v2: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  v_prior_end := (p_date_start - INTERVAL '1 day')::DATE;

  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0)
  INTO v_revenue, v_cogs, v_opex
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND a.account_class IN (4, 5, 6);

  v_net_profit := (v_revenue - v_cogs - v_opex)::NUMERIC(14,2);

  SELECT
    COALESCE(SUM(CASE WHEN a.code LIKE '113%' AND je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '113%' AND je.entry_date <= p_date_end  THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '114%' AND je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '114%' AND je.entry_date <= p_date_end  THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2141'    AND je.entry_date <= v_prior_end THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2141'    AND je.entry_date <= p_date_end  THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '111%' AND je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '111%' AND je.entry_date <= p_date_end  THEN (jel.debit - jel.credit) END), 0)
  INTO
    v_ar_start, v_ar_end, v_inv_start, v_inv_end,
    v_ap_start, v_ap_end, v_cash_start, v_cash_end
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date <= p_date_end
    AND (a.code LIKE '111%' OR a.code LIKE '113%' OR a.code LIKE '114%' OR a.code = '2141');

  v_delta_ar  := (-(v_ar_end  - v_ar_start ))::NUMERIC(14,2);
  v_delta_inv := (-(v_inv_end - v_inv_start))::NUMERIC(14,2);
  v_delta_ap  := ( (v_ap_end  - v_ap_start ))::NUMERIC(14,2);

  v_operating_total := (v_net_profit + v_delta_ar + v_delta_ap + v_delta_inv)::NUMERIC(14,2);
  v_net_change      := v_operating_total;

  RETURN jsonb_build_object(
    'operating', jsonb_build_object(
      'net_profit',           v_net_profit,
      'delta_ar',             v_delta_ar,
      'delta_ap',             v_delta_ap,
      'delta_inventory',      v_delta_inv,
      'non_cash_adjustments', 0::NUMERIC(14,2),
      'total',                v_operating_total
    ),
    'investing', jsonb_build_object('total', 0::NUMERIC(14,2)),
    'financing', jsonb_build_object('total', 0::NUMERIC(14,2)),
    'net_change_in_cash', v_net_change,
    'cash_start',         v_cash_start,
    'cash_end',           v_cash_end,
    'period', jsonb_build_object(
      'start', p_date_start,
      'end',   p_date_end
    )
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Paires REVOKE (S25) : anon herite EXECUTE via PUBLIC, REVOKE FROM anon seul
-- serait insuffisant.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_sales_by_category_v3(DATE, DATE)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_staff_v3(DATE, DATE)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_basket_analysis_v3(DATE, DATE, INTEGER)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_cash_flow_v2(DATE, DATE)                  FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_sales_by_category_v3(DATE, DATE)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_staff_v3(DATE, DATE)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_basket_analysis_v3(DATE, DATE, INTEGER)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_v2(DATE, DATE)                  TO authenticated;

-- Versioning monotone : les versions precedentes sont droppees ici meme.
DROP FUNCTION IF EXISTS public.get_sales_by_category_v2(DATE, DATE);
DROP FUNCTION IF EXISTS public.get_sales_by_staff_v2(DATE, DATE);
DROP FUNCTION IF EXISTS public.get_basket_analysis_v2(DATE, DATE, INTEGER);
DROP FUNCTION IF EXISTS public.get_cash_flow_v1(DATE, DATE);
