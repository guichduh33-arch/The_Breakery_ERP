-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public._dashboard_hourly_v1(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_series JSONB;
  v_peak   JSONB;
BEGIN
  WITH hours AS (SELECT generate_series(6, 17) AS hour),
  sales AS (
    SELECT EXTRACT(HOUR FROM (o.recognized_at AT TIME ZONE p_tz))::INT AS hour,
           ((o.recognized_at AT TIME ZONE p_tz))::date                 AS day,
           o.total
      FROM reporting_private.recognized_sales_v1 o
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 7)
  ),
  buckets AS (
    SELECT h.hour,
           COALESCE(SUM(s.total) FILTER (WHERE s.day = p_today), 0)::NUMERIC(14,2)     AS today,
           COALESCE(SUM(s.total) FILTER (WHERE s.day = p_today - 7), 0)::NUMERIC(14,2) AS last_week
      FROM hours h
      LEFT JOIN sales s ON s.hour = h.hour
     GROUP BY h.hour
  ),
  windows AS (
    SELECT hour,
           SUM(today) OVER (ORDER BY hour ROWS BETWEEN CURRENT ROW AND 2 FOLLOWING) AS win_total,
           COUNT(*)   OVER (ORDER BY hour ROWS BETWEEN CURRENT ROW AND 2 FOLLOWING) AS win_size,
           SUM(today) OVER ()                                                       AS day_total
      FROM buckets
  )
  SELECT (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'hour', b.hour, 'today', b.today, 'last_week', b.last_week
                 ) ORDER BY b.hour), '[]'::jsonb) FROM buckets b),
         (SELECT jsonb_build_object(
                   'from_hour', w.hour,
                   'to_hour',   w.hour + 3,
                   'share_pct', ROUND((w.win_total / w.day_total) * 100, 1))
            FROM windows w
           WHERE w.win_size = 3 AND w.day_total > 0
           ORDER BY w.win_total DESC, w.hour
           LIMIT 1)
    INTO v_series, v_peak;

  RETURN jsonb_build_object('series', v_series, 'peak', v_peak);
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_hourly_v1(p_tz text, p_today date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._dashboard_hourly_v1(p_tz text, p_today date) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
