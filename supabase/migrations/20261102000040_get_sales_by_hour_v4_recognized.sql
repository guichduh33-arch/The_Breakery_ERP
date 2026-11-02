-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_sales_by_hour_v4(p_date date)
 RETURNS TABLE(hour integer, total numeric, order_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH cfg AS (SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz FROM business_config WHERE id = 1),
  bucketed AS (
    SELECT EXTRACT(HOUR FROM (o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::INT AS hour, o.total
    FROM reporting_private.recognized_sales_v1 o
    WHERE TRUE AND o.recognized_at IS NOT NULL AND o.voided_at IS NULL
      AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::date = p_date
  ),
  rolled AS (SELECT b.hour, SUM(b.total)::DECIMAL(14,2) AS total, COUNT(*)::INT AS order_count FROM bucketed b GROUP BY b.hour),
  hours AS (SELECT generate_series(0, 23) AS hour)
  SELECT hours.hour, COALESCE(rolled.total, 0::DECIMAL(14,2)) AS total, COALESCE(rolled.order_count, 0) AS order_count
  FROM hours LEFT JOIN rolled USING (hour) ORDER BY hours.hour;
END; $function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_hour_v4(p_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_hour_v4(p_date date) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
