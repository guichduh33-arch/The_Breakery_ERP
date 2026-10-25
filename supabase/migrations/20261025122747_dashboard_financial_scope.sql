-- Coûts et marge réservés au droit financier ; MTD borné au jour métier.
CREATE OR REPLACE FUNCTION public._dashboard_cost_mtd_v2(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH bounds AS (
    SELECT date_trunc('month', p_today)::date                        AS m_start,
           (date_trunc('month', p_today) - interval '1 month')::date AS p_start,
           (date_trunc('month', p_today) - interval '1 day')::date   AS p_end
  ),
  lines AS (
    SELECT a.code, a.name, a.account_class,
           SUM(l.debit - l.credit) FILTER (WHERE j.entry_date BETWEEN b.m_start AND p_today) AS mtd,
           SUM(l.debit - l.credit) FILTER (
             WHERE j.entry_date BETWEEN b.p_start AND b.p_end)              AS prev
      FROM journal_entry_lines l
      JOIN accounts a        ON a.id = l.account_id
      JOIN journal_entries j ON j.id = l.journal_entry_id AND j.status = 'posted'
      CROSS JOIN bounds b
     WHERE a.account_type = 'expense'
       AND j.entry_date BETWEEN b.p_start AND p_today
     GROUP BY a.code, a.name, a.account_class
  ),
  scoped AS (
    SELECT code, name,
           CASE WHEN account_class = 5 THEN 'cogs' ELSE 'opex' END AS family,
           COALESCE(mtd, 0) AS mtd, COALESCE(prev, 0) AS prev
      FROM lines
     WHERE COALESCE(mtd, 0) <> 0 OR COALESCE(prev, 0) <> 0
  ),
  sales_mtd AS (
    SELECT COALESCE(SUM(o.total), 0) AS net, COUNT(*) AS orders
      FROM orders o CROSS JOIN bounds b
     WHERE o.status IN ('paid', 'completed') AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE p_tz))::date BETWEEN b.m_start AND p_today
  ),
  totals AS (
    SELECT COALESCE((SELECT SUM(mtd) FROM scoped WHERE family = 'cogs'), 0) AS cogs,
           COALESCE((SELECT SUM(mtd) FROM scoped WHERE family = 'opex'), 0) AS opex,
           COALESCE((SELECT SUM(mtd) FROM scoped), 0)                       AS all_cost,
           (SELECT net FROM sales_mtd)                                      AS sales,
           (SELECT orders FROM sales_mtd)                                   AS orders
  )
  SELECT jsonb_build_object(
    'cogs_total',        t.cogs,
    'opex_total',        t.opex,
    'sales_mtd',         t.sales,
    'cogs_pct_of_sales', ROUND((t.cogs / NULLIF(t.sales, 0)) * 100, 1),
    'opex_pct_of_sales', ROUND((t.opex / NULLIF(t.sales, 0)) * 100, 1),
    'total',             t.all_cost,
    'cost_per_basket',   CASE WHEN t.orders = 0 THEN NULL
                              ELSE ROUND(t.all_cost / t.orders, 0) END,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                 'account_code', code, 'account_name', name, 'family', family,
                 'amount', ROUND(mtd), 'mom_delta_pct', _pct_change(mtd, prev)
               ) ORDER BY mtd DESC) FROM scoped), '[]'::jsonb)
  ) INTO v_out FROM totals t;

  RETURN v_out;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v4()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_today  DATE;
  v_kpis   JSONB;
  v_rev    JSONB;
  v_hourly JSONB;
  v_sp     JSONB;
  v_cost   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  v_kpis   := _dashboard_kpis_v2(v_tz, v_today);
  v_rev    := _dashboard_revenue_series_v1(v_tz, v_today);
  v_hourly := _dashboard_hourly_v1(v_tz, v_today);
  v_sp     := _dashboard_share_payments_v2(v_tz, v_today);

  IF has_permission(auth.uid(), 'reports.financial.read') THEN
    v_cost := _dashboard_cost_mtd_v2(v_tz, v_today);
  ELSE
    v_kpis := jsonb_set(v_kpis, '{gross_margin}', jsonb_build_object(
      'restricted', TRUE, 'value', NULL, 'vs_yesterday_pt', NULL,
      'vs_d7_pt', NULL, 'basis', NULL, 'cost_coverage_pct', NULL));
    v_cost := jsonb_build_object(
      'restricted', TRUE, 'cogs_total', NULL, 'opex_total', NULL,
      'sales_mtd', NULL, 'cogs_pct_of_sales', NULL, 'opex_pct_of_sales', NULL,
      'total', NULL, 'cost_per_basket', NULL, 'lines', '[]'::jsonb);
  END IF;

  IF has_permission(auth.uid(), 'accounting.cash.read') THEN
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}', _dashboard_cash_on_hand_v1());
  ELSE
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}',
                jsonb_build_object('value', NULL, 'restricted', TRUE,
                                   'wallets', '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object(
    'kpis',                v_kpis,
    'revenue_30d',         v_rev    -> 'series',
    'revenue_30d_summary', v_rev    -> 'summary',
    'hourly_sales',        v_hourly -> 'series',
    'hourly_peak',         v_hourly -> 'peak',
    'revenue_share',       v_sp     -> 'revenue_share',
    'payments',            v_sp     -> 'payments',
    'cost_mtd',            v_cost,
    'generated_at',        now()
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_cost_mtd_v2(text,date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._dashboard_cost_mtd_v2(text,date) TO service_role;
REVOKE ALL ON FUNCTION public.get_dashboard_overview_v4() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v4() TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.get_dashboard_overview_v3();
DROP FUNCTION public._dashboard_cost_mtd_v1(text,date);
