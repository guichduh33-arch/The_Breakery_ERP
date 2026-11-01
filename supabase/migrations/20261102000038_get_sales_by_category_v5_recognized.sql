-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_sales_by_category_v5(p_date_start date, p_date_end date)
 RETURNS TABLE(category_id uuid, category_name text, total numeric, qty numeric)
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
    c.id                                   AS category_id,
    c.name                                 AS category_name,
    COALESCE(SUM(oi.line_total), 0)::DECIMAL(14,2) AS total,
    COALESCE(SUM(oi.quantity),  0)::DECIMAL(12,3)  AS qty
  FROM order_items oi
  JOIN reporting_private.recognized_sales_v1     o ON o.id = oi.order_id
  JOIN products   p ON p.id = oi.product_id
  JOIN categories c ON c.id = p.category_id
  WHERE TRUE
    AND o.recognized_at IS NOT NULL
    AND o.voided_at IS NULL
    AND oi.is_cancelled = false
    AND oi.is_promo_gift = false
    AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY c.id, c.name
  ORDER BY total DESC;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_category_v5(p_date_start date, p_date_end date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_category_v5(p_date_start date, p_date_end date) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
