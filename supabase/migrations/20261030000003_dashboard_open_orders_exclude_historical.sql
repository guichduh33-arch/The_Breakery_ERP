-- Corps live dev relu le 2026-10-30, identique a la production avant ce correctif.
CREATE OR REPLACE FUNCTION public.get_dashboard_open_orders_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows  JSONB;
  v_total NUMERIC;
  v_count INT;
  v_late  INT;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'orders.read') THEN
    RAISE EXCEPTION 'permission denied: orders.read required'
      USING ERRCODE = '42501';
  END IF;

  WITH open_orders AS (
    SELECT o.id, o.order_number, o.order_type, o.total,
           EXTRACT(EPOCH FROM (now() - o.created_at)) / 60 AS minutes_open,
           CASE o.order_type
             WHEN 'dine_in'  THEN COALESCE(NULLIF(btrim(o.table_number), ''), 'Dine-in')
             WHEN 'take_out' THEN 'Take-away'
             WHEN 'delivery' THEN 'Delivery'
             WHEN 'b2b'      THEN COALESCE(NULLIF(btrim(c.b2b_company_name), ''), c.name, 'B2B')
           END AS destination
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
     WHERE o.status IN ('draft', 'pending_payment')
       AND o.voided_at IS NULL
       AND o.is_held IS NOT TRUE
       AND o.financial_import_document_id IS NULL
       AND o.is_historical_import IS NOT TRUE
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',           oo.id,
           'order_number', oo.order_number,
           'order_type',   oo.order_type,
           'destination',  oo.destination,
           'total',        oo.total,
           'minutes_open', ROUND(oo.minutes_open)
         ) ORDER BY oo.minutes_open DESC), '[]'::jsonb),
         COALESCE(SUM(oo.total), 0),
         COUNT(*)::INT,
         COUNT(*) FILTER (WHERE oo.minutes_open > 45)::INT
    INTO v_rows, v_total, v_count, v_late
    FROM open_orders oo;

  RETURN jsonb_build_object(
    'orders',        v_rows,
    'open_count',    v_count,
    'open_total',    v_total,
    'over_45_count', v_late,
    'generated_at',  now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_dashboard_open_orders_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_open_orders_v2() TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.get_dashboard_open_orders_v1();
