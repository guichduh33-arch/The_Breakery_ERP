-- Corps production relevé par pg_get_functiondef ; ancien contrat conservé pendant la transition.
CREATE OR REPLACE FUNCTION public.get_pos_payment_breakdown_v2(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT has_permission(v_uid, 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range: start date is after end date' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(timezone, 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;
  v_tz := COALESCE(v_tz, 'Asia/Makassar');

  WITH scoped_orders AS (
    SELECT o.id, o.total
    FROM orders o
    WHERE (o.status <> 'voided' OR o.outstanding_at IS NOT NULL)
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test
      )
  ),
  tenders AS (
    SELECT op.order_id, op.method::text AS method, op.amount
    FROM order_payments op
    JOIN scoped_orders so ON so.id = op.order_id
    WHERE (op.paid_at AT TIME ZONE v_tz)::date BETWEEN p_start_date AND p_end_date
  ),
  grp AS (
    SELECT method, SUM(amount) AS amount, COUNT(*)::int AS tenders
    FROM tenders
    GROUP BY method
  ),
  tot AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_amount,
           COALESCE(SUM(tenders), 0)::int    AS total_tenders
    FROM grp
  ),
  ords AS (SELECT COUNT(DISTINCT order_id)::int AS c FROM tenders)
  SELECT jsonb_build_object(
    'timezone',       v_tz,
    'total_amount',   (SELECT total_amount  FROM tot),
    'total_orders',   (SELECT c             FROM ords),
    'total_tenders',  (SELECT total_tenders FROM tot),
    'by_method', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.amount DESC)
      FROM (
        SELECT
          g.method,
          g.amount,
          g.tenders,
          CASE WHEN (SELECT total_amount FROM tot) = 0 THEN 0
               ELSE ROUND(g.amount / (SELECT total_amount FROM tot) * 100, 2)
          END AS share_pct
        FROM grp g
      ) x
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_payment_breakdown_v2(p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_payment_breakdown_v2(p_start_date date, p_end_date date) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
