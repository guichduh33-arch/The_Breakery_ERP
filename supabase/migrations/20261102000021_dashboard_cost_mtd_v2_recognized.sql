-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
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
      FROM reporting_private.recognized_sales_v1 o CROSS JOIN bounds b
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date BETWEEN b.m_start AND p_today
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
REVOKE ALL ON FUNCTION public._dashboard_cost_mtd_v2(p_tz text, p_today date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._dashboard_cost_mtd_v2(p_tz text, p_today date) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
