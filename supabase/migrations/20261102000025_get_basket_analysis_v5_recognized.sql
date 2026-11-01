-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_basket_analysis_v5(p_date_start date, p_date_end date, p_top_n integer DEFAULT 10)
 RETURNS TABLE(product_id_a uuid, product_a_name text, product_id_b uuid, product_b_name text, co_occurrence_count integer, support_a numeric, support_b numeric, support_pair numeric, confidence numeric, lift numeric)
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
  ),
  filtered_orders AS (
    SELECT o.id
    FROM reporting_private.recognized_sales_v1 o
    WHERE TRUE
      AND o.recognized_at IS NOT NULL
      AND o.voided_at IS NULL
      AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg))::date
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
$function$
;
REVOKE ALL ON FUNCTION public.get_basket_analysis_v5(p_date_start date, p_date_end date, p_top_n integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_basket_analysis_v5(p_date_start date, p_date_end date, p_top_n integer) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
