-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_sales_by_staff_v4(p_date_start date, p_date_end date)
 RETURNS TABLE(staff_id uuid, staff_name text, total numeric, order_count integer, avg_basket numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  FROM reporting_private.recognized_sales_v1 o
  JOIN user_profiles up ON up.id = o.served_by
  WHERE TRUE
    AND o.recognized_at IS NOT NULL
    AND o.voided_at IS NULL
    AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY o.served_by, up.full_name
  ORDER BY total DESC;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_staff_v4(p_date_start date, p_date_end date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_staff_v4(p_date_start date, p_date_end date) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
