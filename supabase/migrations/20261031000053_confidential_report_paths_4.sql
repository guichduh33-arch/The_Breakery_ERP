CREATE OR REPLACE FUNCTION public.get_sales_by_category_v4(p_date_start date, p_date_end date)
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
  PERFORM public.assert_business_days_visible_v1(p_date_start::date,p_date_end::date);


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
$function$
;
DROP FUNCTION public.get_sales_by_category_v3(p_date_start date, p_date_end date);
REVOKE ALL ON FUNCTION public.get_sales_by_category_v4(p_date_start date, p_date_end date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_category_v4(p_date_start date, p_date_end date) TO authenticated;

