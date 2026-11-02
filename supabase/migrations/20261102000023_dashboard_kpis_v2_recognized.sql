-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public._dashboard_kpis_v2(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out JSONB;
BEGIN
  WITH ref_days AS (
    SELECT p_today AS day, 'today' AS slot
    UNION ALL SELECT p_today - 1, 'yesterday'
    UNION ALL SELECT p_today - 7, 'd7'
  ),
  valid AS (
    SELECT ((o.recognized_at AT TIME ZONE p_tz))::date AS day, o.id, o.total, o.customer_id
      FROM reporting_private.recognized_sales_v1 o
     WHERE TRUE
       AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 1, p_today - 7)
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE p_tz))::date AS day, SUM(r.total) AS refunds
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 1, p_today - 7)
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  day_items AS (
    SELECT v.day,
           SUM(oi.quantity)                             AS qty,
           SUM(oi.quantity * COALESCE(p.cost_price, 0)) AS cogs,
           SUM(oi.line_total)                           AS line_rev,
           SUM(oi.line_total) FILTER (
             WHERE p.cost_price IS NOT NULL AND p.cost_price > 0)  AS costed_rev
      FROM order_items oi
      JOIN valid v         ON v.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
     WHERE NOT oi.is_cancelled
     GROUP BY v.day
  ),
  metrics AS (
    SELECT rd.slot,
           COALESCE(SUM(v.total), 0)                                AS gross,
           COALESCE(SUM(v.total), 0) - COALESCE(MAX(dr.refunds), 0) AS net,
           COUNT(v.id)                                              AS order_count,
           COUNT(DISTINCT v.customer_id)                            AS customer_count,
           COALESCE(MAX(di.qty), 0)                                 AS items,
           COALESCE(MAX(di.cogs), 0)                                AS cogs,
           COALESCE(MAX(di.line_rev), 0)                            AS line_rev,
           COALESCE(MAX(di.costed_rev), 0)                          AS costed_rev
      FROM ref_days rd
      LEFT JOIN valid       v  ON v.day  = rd.day
      LEFT JOIN day_refunds dr ON dr.day = rd.day
      LEFT JOIN day_items   di ON di.day = rd.day
     GROUP BY rd.slot
  ),
  s AS (
    SELECT slot, net, order_count, customer_count, items,
           CASE WHEN order_count = 0 THEN 0 ELSE ROUND(gross / order_count, 2) END AS basket,
           CASE WHEN net <= 0 THEN NULL ELSE ROUND(((net - cogs) / net) * 100, 2) END AS margin,
           CASE WHEN line_rev <= 0 THEN NULL
                ELSE ROUND((costed_rev / line_rev) * 100, 2) END AS coverage
      FROM metrics
  ),
  p AS (
    SELECT
      (SELECT net            FROM s WHERE slot = 'today')     AS net_t,
      (SELECT net            FROM s WHERE slot = 'yesterday') AS net_y,
      (SELECT net            FROM s WHERE slot = 'd7')        AS net_7,
      (SELECT order_count    FROM s WHERE slot = 'today')     AS ord_t,
      (SELECT order_count    FROM s WHERE slot = 'yesterday') AS ord_y,
      (SELECT order_count    FROM s WHERE slot = 'd7')        AS ord_7,
      (SELECT customer_count FROM s WHERE slot = 'today')     AS cst_t,
      (SELECT customer_count FROM s WHERE slot = 'yesterday') AS cst_y,
      (SELECT customer_count FROM s WHERE slot = 'd7')        AS cst_7,
      (SELECT items          FROM s WHERE slot = 'today')     AS itm_t,
      (SELECT items          FROM s WHERE slot = 'yesterday') AS itm_y,
      (SELECT items          FROM s WHERE slot = 'd7')        AS itm_7,
      (SELECT basket         FROM s WHERE slot = 'today')     AS bkt_t,
      (SELECT basket         FROM s WHERE slot = 'yesterday') AS bkt_y,
      (SELECT basket         FROM s WHERE slot = 'd7')        AS bkt_7,
      (SELECT margin         FROM s WHERE slot = 'today')     AS mrg_t,
      (SELECT margin         FROM s WHERE slot = 'yesterday') AS mrg_y,
      (SELECT margin         FROM s WHERE slot = 'd7')        AS mrg_7,
      (SELECT coverage       FROM s WHERE slot = 'today')     AS cov_t
  )
  SELECT jsonb_build_object(
    'net_revenue', jsonb_build_object(
      'value', p.net_t, 'vs_yesterday', _pct_change(p.net_t, p.net_y),
      'vs_d7', _pct_change(p.net_t, p.net_7)),
    'orders', jsonb_build_object(
      'value', p.ord_t, 'vs_yesterday', _pct_change(p.ord_t, p.ord_y),
      'vs_d7', _pct_change(p.ord_t, p.ord_7)),
    'customers', jsonb_build_object(
      'value', p.cst_t, 'vs_yesterday', _pct_change(p.cst_t, p.cst_y),
      'vs_d7', _pct_change(p.cst_t, p.cst_7)),
    'items_sold', jsonb_build_object(
      'value', p.itm_t, 'vs_yesterday', _pct_change(p.itm_t, p.itm_y),
      'vs_d7', _pct_change(p.itm_t, p.itm_7)),
    'avg_basket', jsonb_build_object(
      'value', p.bkt_t, 'vs_yesterday', _pct_change(p.bkt_t, p.bkt_y),
      'vs_d7', _pct_change(p.bkt_t, p.bkt_7)),
    'gross_margin', jsonb_build_object(
      'value', p.mrg_t,
      'vs_yesterday_pt', ROUND(p.mrg_t - p.mrg_y, 2),
      'vs_d7_pt',        ROUND(p.mrg_t - p.mrg_7, 2),
      'basis',             'current_cost_price',
      'cost_coverage_pct', p.cov_t)
  ) INTO v_out FROM p;

  RETURN v_out;
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_kpis_v2(p_tz text, p_today date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._dashboard_kpis_v2(p_tz text, p_today date) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
