-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public._dashboard_revenue_series_v1(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_series  JSONB;
  v_summary JSONB;
BEGIN
  WITH days AS (
    SELECT d::date AS day, ROW_NUMBER() OVER (ORDER BY d) AS idx
      FROM generate_series(p_today - 59, p_today, interval '1 day') d
  ),
  valid AS (
    SELECT ((o.recognized_at AT TIME ZONE p_tz))::date AS day, o.total
      FROM reporting_private.recognized_sales_v1 o
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date BETWEEN p_today - 59 AND p_today
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE p_tz))::date AS day, SUM(r.total) AS refunds
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE p_tz))::date BETWEEN p_today - 59 AND p_today
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  series AS (
    SELECT d.day, d.idx,
           (COALESCE(SUM(v.total), 0) - COALESCE(MAX(dr.refunds), 0))::NUMERIC(14,2) AS net
      FROM days d
      LEFT JOIN valid       v  ON v.day  = d.day
      LEFT JOIN day_refunds dr ON dr.day = d.day
     GROUP BY d.day, d.idx
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'date', cur.day, 'net', cur.net, 'prev_net', prev.net
         ) ORDER BY cur.day), '[]'::jsonb),
         jsonb_build_object(
           'total',      COALESCE(SUM(cur.net), 0),
           'prev_total', COALESCE(SUM(prev.net), 0),
           'delta_pct',  _pct_change(COALESCE(SUM(cur.net), 0),
                                     COALESCE(SUM(prev.net), 0)))
    INTO v_series, v_summary
    FROM series cur
    LEFT JOIN series prev ON prev.idx = cur.idx - 30
   WHERE cur.idx > 30;

  RETURN jsonb_build_object('series', v_series, 'summary', v_summary);
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_revenue_series_v1(p_tz text, p_today date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._dashboard_revenue_series_v1(p_tz text, p_today date) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
