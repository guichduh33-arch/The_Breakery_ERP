-- Corps production relevé par pg_get_functiondef ; ancien contrat conservé pendant la transition.
CREATE OR REPLACE FUNCTION public.get_daily_sales_v4(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_tz       TEXT;
  v_summary  JSONB;
  v_by_day   JSONB;
  v_sessions JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH valid_orders AS (
    SELECT o.id,
           o.total, o.outstanding_at,
           COALESCE(o.discount_amount, 0) + COALESCE(o.promotion_total, 0) AS discount,
           ((o.recognized_at AT TIME ZONE v_tz))::date AS day,
           EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id = o.id) AS tendered
      FROM reporting_private.recognized_sales_v1 o
     WHERE TRUE
       AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  day_orders AS (
    SELECT vo.day, COUNT(*)::INT AS order_count, SUM(vo.total)::NUMERIC(14,2) AS gross
      FROM valid_orders vo GROUP BY vo.day
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day, SUM(r.total) AS refund_total
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND NOT r.is_full_void
     GROUP BY 1
  ),
  days AS (
    SELECT COALESCE(o.day, r.day) AS day,
           COALESCE(o.order_count, 0) AS order_count,
           COALESCE(o.gross, 0)::NUMERIC(14,2) AS gross,
           COALESCE(r.refund_total, 0)::NUMERIC(14,2) AS refunds
      FROM day_orders o FULL OUTER JOIN day_refunds r ON r.day = o.day
  ),
  discounts AS (
    SELECT COALESCE(SUM(vo.discount), 0)::NUMERIC(14,2) AS discount_total,
           COUNT(*) FILTER (WHERE vo.discount > 0)::INT AS discount_orders_count
      FROM valid_orders vo
  ),
  settlement AS (
    SELECT
      COALESCE(SUM(vo.total) FILTER (WHERE vo.tendered), 0)::NUMERIC(14,2)     AS tendered_total,
      COUNT(*) FILTER (WHERE vo.tendered)::INT                                  AS tendered_order_count,
      COALESCE(SUM(vo.total) FILTER (WHERE NOT vo.tendered), 0)::NUMERIC(14,2) AS on_account_total,
      COUNT(*) FILTER (WHERE NOT vo.tendered)::INT                              AS on_account_order_count
      FROM valid_orders vo
  ),
  receipts AS (
    SELECT coalesce(sum(p.amount),0) total, count(DISTINCT p.order_id) order_count,
      coalesce(sum(p.amount) FILTER (WHERE o.outstanding_at IS NOT NULL),0) outstanding_collections
    FROM order_payments p JOIN orders o ON o.id=p.order_id
    WHERE (p.paid_at AT TIME ZONE v_tz)::date BETWEEN v_start AND v_end
      AND (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
  ),
  receivables AS (
    SELECT coalesce(sum(greatest(o.total-coalesce(p.paid,0),0)),0) due
    FROM orders o LEFT JOIN LATERAL
      (SELECT sum(amount) paid FROM order_payments WHERE order_id=o.id) p ON true
    WHERE o.outstanding_at IS NOT NULL AND o.status IN ('draft','pending_payment')
  ),
  voids AS (
    SELECT COUNT(*)::INT AS voids_count,
           COALESCE(SUM(o.total), 0)::NUMERIC(14,2) AS voids_value
      FROM orders o
     WHERE o.voided_at IS NOT NULL
       AND ((o.voided_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  )
  SELECT
    jsonb_build_object(
      'total',                 COALESCE(SUM(d.gross), 0),
      'order_count',           COALESCE(SUM(d.order_count), 0),
      'aov',                   CASE WHEN COALESCE(SUM(d.order_count), 0) = 0 THEN 0
                                    ELSE ROUND(SUM(d.gross) / SUM(d.order_count), 2) END,
      'refund_total',          COALESCE(SUM(d.refunds), 0),
      'net',                   COALESCE(SUM(d.gross), 0) - COALESCE(SUM(d.refunds), 0),
      'discount_total',        (SELECT discount_total FROM discounts),
      'discount_orders_count', (SELECT discount_orders_count FROM discounts),
      'voids_count',           (SELECT voids_count FROM voids),
      'voids_value',           (SELECT voids_value FROM voids),
      'tendered_total',          (SELECT tendered_total FROM settlement),
      'tendered_order_count',    (SELECT tendered_order_count FROM settlement),
      'on_account_total',        (SELECT on_account_total FROM settlement),
      'on_account_order_count',  (SELECT on_account_order_count FROM settlement),
      'receipts_total', (SELECT total FROM receipts),
      'receipts_order_count', (SELECT order_count FROM receipts),
      'outstanding_collections_total', (SELECT outstanding_collections FROM receipts),
      'outstanding_created_total', (SELECT coalesce(sum(total),0) FROM valid_orders WHERE outstanding_at IS NOT NULL),
      'outstanding_due_total', (SELECT due FROM receivables)
    ),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'date',        d.day,
        'order_count', d.order_count,
        'gross',       d.gross,
        'refunds',     d.refunds,
        'net',         d.gross - d.refunds,
        'aov',         CASE WHEN d.order_count = 0 THEN 0 ELSE ROUND(d.gross / d.order_count, 2) END
      ) ORDER BY d.day
    ), '[]'::jsonb)
  INTO v_summary, v_by_day
  FROM days d;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',             ps.id,
      'cashier',        up.full_name,
      'opened_at',      ps.opened_at,
      'opening_cash',   ps.opening_cash,
      'status',         ps.status::text,
      'closed_at',      ps.closed_at,
      'variance_total', ps.variance_total
    ) ORDER BY ps.opened_at
  ), '[]'::jsonb)
  INTO v_sessions
  FROM pos_sessions ps
  LEFT JOIN user_profiles up ON up.id = ps.opened_by
  WHERE ((ps.opened_at AT TIME ZONE v_tz))::date <= v_end
    AND (ps.closed_at IS NULL OR ((ps.closed_at AT TIME ZONE v_tz))::date >= v_start);

  RETURN jsonb_build_object(
    'period',   jsonb_build_object('start', v_start, 'end', v_end),
    'summary',  v_summary,
    'by_day',   v_by_day,
    'sessions', v_sessions
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_daily_sales_v4(p_date_start text, p_date_end text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_v4(p_date_start text, p_date_end text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
