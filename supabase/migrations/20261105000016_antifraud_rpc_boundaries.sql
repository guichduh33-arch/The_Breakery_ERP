-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_pos_sessions_report_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_sessions JSONB;
  v_summary  JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT ps.*
      FROM reporting_private.closed_pos_sessions_v1 ps
     WHERE ((ps.opened_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  order_agg AS (
    SELECT o.session_id,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'voided' AND (o.outstanding_at IS NOT NULL OR o.status IN ('paid','completed'))), 0) AS sales_total,
           COUNT(*)              FILTER (WHERE o.status::text <> 'voided' AND (o.outstanding_at IS NOT NULL OR o.status IN ('paid','completed')))     AS order_count,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text =  'voided'), 0) AS voids_total
      FROM reporting_private.closed_pos_orders_v1 o
     WHERE o.session_id IN (SELECT id FROM scoped)
     GROUP BY o.session_id
  ),
  refund_agg AS (
    SELECT reporting_private.refund_payment_session_v1(r::public.refunds) AS session_id, COALESCE(SUM(r.total), 0) AS refunds_total
      FROM reporting_private.closed_refunds_v1 r
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = r.order_id
     WHERE reporting_private.refund_payment_session_v1(r::public.refunds) IN (SELECT id FROM scoped) AND (NOT r.is_full_void OR o.outstanding_at IS NOT NULL)
     GROUP BY reporting_private.refund_payment_session_v1(r::public.refunds)
  ),
  session_rows AS (
    SELECT
      s.id,
      s.status::text                                       AS status,
      s.opened_by                                          AS cashier_id,
      COALESCE(uo.full_name, '—')                          AS cashier_name,
      s.closed_by                                          AS closed_by_id,
      cb.full_name                                         AS closed_by_name,
      s.opened_at,
      s.closed_at,
      s.opening_cash,
      CASE WHEN s.status='closed' AND zr.snapshot IS NOT NULL THEN coalesce((zr.snapshot->>'sales_total')::numeric,0) ELSE COALESCE(oa.sales_total,0) END AS sales_total,
      COALESCE(oa.order_count, 0)                          AS order_count,
      CASE WHEN s.status='closed' AND zr.snapshot IS NOT NULL THEN coalesce((zr.snapshot->>'refunds_total')::numeric,0) ELSE COALESCE(ra.refunds_total,0) END AS refunds_total,
      CASE WHEN s.status='closed' AND zr.snapshot IS NOT NULL THEN coalesce((zr.snapshot->>'voids_total')::numeric,0) ELSE COALESCE(oa.voids_total,0) END AS voids_total,
      COALESCE(CASE WHEN s.status='closed' THEN (zr.snapshot->>'receipts_total')::numeric END,
        (SELECT coalesce(sum(op.amount),0) FROM reporting_private.closed_order_payments_v1 op JOIN reporting_private.closed_pos_orders_v1 po ON po.id=op.order_id
         WHERE op.session_id=s.id AND (po.status<>'voided' OR po.outstanding_at IS NOT NULL))) AS receipts_total,
      COALESCE((sc.metadata->>'expected_cash')::numeric, s.expected_cash) AS cash_expected,
      COALESCE((sc.metadata->>'counted_cash')::numeric,  s.closing_cash)  AS cash_counted,
      COALESCE((sc.metadata->>'variance')::numeric,      s.variance_total) AS cash_variance,
      (sc.metadata->>'expected_qris')::numeric            AS qris_expected,
      COALESCE((sc.metadata->>'counted_qris')::numeric, s.counted_qris) AS qris_counted,
      (sc.metadata->>'variance_qris')::numeric            AS qris_variance,
      (sc.metadata->>'expected_card')::numeric            AS card_expected,
      COALESCE((sc.metadata->>'counted_card')::numeric, s.counted_card) AS card_counted,
      (sc.metadata->>'variance_card')::numeric            AS card_variance,
      s.opening_notes,
      s.closing_notes,
      (s.variance_approved_by IS NOT NULL)                 AS variance_approved
    FROM scoped s
    JOIN user_profiles uo ON uo.id = s.opened_by
    LEFT JOIN user_profiles cb ON cb.id = s.closed_by
    LEFT JOIN order_agg  oa ON oa.session_id = s.id
    LEFT JOIN LATERAL (SELECT z.snapshot FROM z_reports z WHERE z.shift_id=s.id LIMIT 1) zr ON true
    LEFT JOIN refund_agg ra ON ra.session_id = s.id
    LEFT JOIN LATERAL (
      SELECT al.metadata
        FROM audit_logs al
       WHERE al.action = 'shift.close'
         AND al.entity_type = 'pos_sessions'
         AND al.entity_id = s.id
       ORDER BY al.created_at DESC
       LIMIT 1
    ) sc ON TRUE
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'session_id',      sr.id,
      'status',          sr.status,
      'cashier_id',      sr.cashier_id,
      'cashier_name',    sr.cashier_name,
      'closed_by_id',    sr.closed_by_id,
      'closed_by_name',  sr.closed_by_name,
      'opened_at',       sr.opened_at,
      'closed_at',       sr.closed_at,
      'opening_cash',    sr.opening_cash,
      'sales_total',     sr.sales_total,
      'receipts_total',  sr.receipts_total,
      'order_count',     sr.order_count,
      'refunds_total',   sr.refunds_total,
      'voids_total',     sr.voids_total,
      'cash', jsonb_build_object(
        'expected', sr.cash_expected,
        'counted',  sr.cash_counted,
        'variance', CASE WHEN sr.status = 'open' THEN NULL ELSE sr.cash_variance END
      ),
      'qris', jsonb_build_object(
        'expected', sr.qris_expected,
        'counted',  sr.qris_counted,
        'variance', CASE WHEN sr.qris_counted IS NULL THEN NULL ELSE sr.qris_variance END
      ),
      'card', jsonb_build_object(
        'expected', sr.card_expected,
        'counted',  sr.card_counted,
        'variance', CASE WHEN sr.card_counted IS NULL THEN NULL ELSE sr.card_variance END
      ),
      'opening_notes',     sr.opening_notes,
      'closing_notes',     sr.closing_notes,
      'variance_approved', sr.variance_approved
    ) ORDER BY sr.opened_at DESC
  )
  INTO v_sessions
  FROM session_rows sr;

  WITH scoped AS (
    SELECT ps.id, ps.status::text AS status
      FROM reporting_private.closed_pos_sessions_v1 ps
     WHERE ((ps.opened_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  order_agg AS (
    SELECT o.session_id,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'voided' AND (o.outstanding_at IS NOT NULL OR o.status IN ('paid','completed'))), 0) AS sales_total,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text =  'voided'), 0) AS voids_total
      FROM reporting_private.closed_pos_orders_v1 o
     WHERE o.session_id IN (SELECT id FROM scoped)
     GROUP BY o.session_id
  ),
  cash_close AS (
    SELECT ps.id,
           COALESCE((sc.metadata->>'variance')::numeric, ps.variance_total) AS cash_variance
      FROM reporting_private.closed_pos_sessions_v1 ps
      LEFT JOIN LATERAL (
        SELECT al.metadata FROM audit_logs al
         WHERE al.action = 'shift.close' AND al.entity_type = 'pos_sessions' AND al.entity_id = ps.id
         ORDER BY al.created_at DESC LIMIT 1
      ) sc ON TRUE
     WHERE ps.id IN (SELECT id FROM scoped WHERE status = 'closed')
  )
  SELECT jsonb_build_object(
    'total_sessions',       (SELECT COUNT(*) FROM scoped),
    'open_count',           (SELECT COUNT(*) FROM scoped WHERE status = 'open'),
    'closed_count',         (SELECT COUNT(*) FROM scoped WHERE status = 'closed'),
    'sales_total',          (SELECT coalesce(sum((e->>'sales_total')::numeric),0) FROM jsonb_array_elements(coalesce(v_sessions,'[]'::jsonb)) e),
    'receipts_total',       (SELECT coalesce(sum((e->>'receipts_total')::numeric),0) FROM jsonb_array_elements(coalesce(v_sessions,'[]'::jsonb)) e),
    'voids_total',          (SELECT coalesce(sum((e->>'voids_total')::numeric),0) FROM jsonb_array_elements(coalesce(v_sessions,'[]'::jsonb)) e),
    'cash_variance_total',  (SELECT COALESCE(SUM(cash_variance), 0) FROM cash_close),
    'cash_short_count',     (SELECT COUNT(*) FROM cash_close WHERE cash_variance < 0),
    'cash_over_count',      (SELECT COUNT(*) FROM cash_close WHERE cash_variance > 0)
  ) INTO v_summary;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'summary',      v_summary,
    'sessions',     COALESCE(v_sessions, '[]'::jsonb)
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_sessions_report_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_sessions_report_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_pos_sessions_report_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_pos_sessions_report_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_reorder_suggestions_v3(p_lookback_days integer DEFAULT 30, p_buffer_days integer DEFAULT 14)
 RETURNS TABLE(product_id uuid, product_sku text, product_name text, unit text, current_stock numeric, min_stock_threshold numeric, avg_daily_usage numeric, days_of_stock numeric, suggested_order_qty numeric, supplier_id uuid, supplier_name text, last_purchase_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lookback INT;
  v_buffer   INT;
  v_since    TIMESTAMPTZ;
BEGIN
  PERFORM public.assert_stock_owner_v1();

  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_lookback := GREATEST(COALESCE(p_lookback_days, 30), 1);
  v_buffer   := GREATEST(COALESCE(p_buffer_days, 14), 1);
  v_since    := now() - (v_lookback * INTERVAL '1 day');
  PERFORM public.assert_business_days_visible_v2(v_since::date,current_date);

  RETURN QUERY
  WITH usage AS (
    SELECT
      sm.product_id,
      SUM(ABS(sm.quantity)) / v_lookback::DECIMAL AS avg_daily
    FROM stock_movements sm
    WHERE sm.created_at >= v_since
      AND sm.movement_type IN ('sale','production_out','waste','transfer_out')
    GROUP BY sm.product_id
  ), latest_supplier AS (
    SELECT DISTINCT ON (sm.product_id)
      sm.product_id, sm.supplier_id, sm.created_at
    FROM stock_movements sm
    WHERE sm.supplier_id IS NOT NULL
      AND sm.movement_type IN ('purchase','incoming')
    ORDER BY sm.product_id, sm.created_at DESC
  )
  SELECT
    p.id, p.sku, p.name, p.unit,
    p.current_stock,
    p.min_stock_threshold,
    COALESCE(u.avg_daily, 0)::DECIMAL(10,3),
    CASE
      WHEN COALESCE(u.avg_daily, 0) = 0 THEN NULL
      ELSE (p.current_stock / u.avg_daily)::DECIMAL(10,3)
    END,
    GREATEST(0, COALESCE(u.avg_daily, 0) * v_buffer - p.current_stock)::DECIMAL(10,3),
    ls.supplier_id,
    sup.name,
    ls.created_at
  FROM products p
  LEFT JOIN usage u ON u.product_id = p.id
  LEFT JOIN latest_supplier ls ON ls.product_id = p.id
  LEFT JOIN suppliers sup ON sup.id = ls.supplier_id
  WHERE p.deleted_at IS NULL
    AND p.is_active = true
    AND (
      (COALESCE(u.avg_daily, 0) > 0 AND (p.current_stock / u.avg_daily) < v_buffer)
      OR (p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold)
    )
  ORDER BY
    CASE WHEN COALESCE(u.avg_daily, 0) > 0
         THEN (p.current_stock / u.avg_daily)
         ELSE 0 END ASC,
    p.name;
END $function$
;
REVOKE ALL ON FUNCTION public.get_reorder_suggestions_v3(p_lookback_days integer, p_buffer_days integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_reorder_suggestions_v3(p_lookback_days integer, p_buffer_days integer) TO authenticated,service_role;
DROP FUNCTION public.get_reorder_suggestions_v2(p_lookback_days integer, p_buffer_days integer);

CREATE OR REPLACE FUNCTION public.update_b2b_pickup_v2(p_order_id uuid, p_pickup_date date DEFAULT NULL::date, p_mark_delivered boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_profile uuid;
 v_order public.orders%ROWTYPE;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001'; END IF;
 IF NOT public.has_permission(v_uid, 'b2b.read')
    OR NOT public.has_permission(v_uid, 'b2b.order.create') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0003';
 END IF;
 SELECT id INTO v_profile FROM public.user_profiles
 WHERE auth_user_id = v_uid AND deleted_at IS NULL;
 IF v_profile IS NULL THEN RAISE EXCEPTION 'user_profile_not_found'; END IF;
 SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
 IF NOT FOUND OR v_order.order_type <> 'b2b' THEN
  RAISE EXCEPTION 'b2b_order_not_found' USING ERRCODE = 'P0002';
 END IF;
 IF v_order.status = 'voided' THEN RAISE EXCEPTION 'order_voided'; END IF;
 IF p_mark_delivered IS NULL THEN RAISE EXCEPTION 'delivery_action_required'; END IF;
 IF v_order.b2b_delivered_at IS NOT NULL THEN
  IF NOT p_mark_delivered THEN RAISE EXCEPTION 'order_already_delivered'; END IF;
  RETURN jsonb_build_object('order_id', v_order.id, 'pickup_date', v_order.pickup_date,
    'b2b_delivered_at', v_order.b2b_delivered_at);
 END IF;
 IF NOT p_mark_delivered AND p_pickup_date IS NULL THEN
  RAISE EXCEPTION 'pickup_date_required';
 END IF;
 UPDATE public.orders SET
  pickup_date = COALESCE(p_pickup_date, pickup_date),
  b2b_delivered_at = CASE WHEN p_mark_delivered THEN now() ELSE NULL END,
  updated_at = now()
 WHERE id = p_order_id RETURNING * INTO v_order;
 INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
 VALUES(v_profile, CASE WHEN p_mark_delivered THEN 'b2b.order.delivered' ELSE 'b2b.order.pickup_updated' END,
  'orders', p_order_id, jsonb_build_object('pickup_date', v_order.pickup_date,
    'b2b_delivered_at', v_order.b2b_delivered_at));
 RETURN jsonb_build_object('order_id', v_order.id, 'pickup_date', v_order.pickup_date,
  'b2b_delivered_at', v_order.b2b_delivered_at);
END $function$
;
REVOKE ALL ON FUNCTION public.update_b2b_pickup_v2(p_order_id uuid, p_pickup_date date, p_mark_delivered boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_b2b_pickup_v2(p_order_id uuid, p_pickup_date date, p_mark_delivered boolean) TO authenticated,service_role;
DROP FUNCTION public.update_b2b_pickup_v1(p_order_id uuid, p_pickup_date date, p_mark_delivered boolean);

CREATE OR REPLACE FUNCTION public.get_sales_by_product_v4(p_start_date date, p_end_date date, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz      text;
  v_start   date;
  v_end     date;
  v_result  jsonb;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b')          AS is_b2b,
      COALESCE(o.discount_amount, 0)  AS order_discount,
      COALESCE(o.promotion_total, 0)  AS promotion_total
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT
      oi.order_id,
      oi.product_id,
      p.name                             AS product_name,
      p.category_id                      AS category_id,
      COALESCE(c.name, 'Uncategorized')  AS category_name,
      s.is_b2b,
      oi.quantity,
      oi.line_total,
      COALESCE(oi.discount_amount, 0)    AS discount_amount
    FROM reporting_private.closed_order_items_v1 oi
    JOIN scoped   s ON s.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ),
  tot AS (
    SELECT
      COALESCE(SUM(line_total), 0)      AS revenue,
      COALESCE(SUM(quantity), 0)        AS qty,
      COALESCE(SUM(discount_amount), 0) AS discount,
      COUNT(*)                          AS line_count,
      COUNT(DISTINCT order_id)          AS order_count,
      COUNT(DISTINCT product_id)        AS product_count,
      COALESCE(SUM(line_total) FILTER (WHERE NOT is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE NOT is_b2b), 0) AS counter_qty,
      COALESCE(SUM(line_total) FILTER (WHERE is_b2b), 0)     AS b2b_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE is_b2b), 0)     AS b2b_qty
    FROM lines
  ),
  unattributed AS (
    SELECT
      COALESCE(SUM(s.order_discount), 0)  AS order_discount,
      COALESCE(SUM(s.promotion_total), 0) AS promotion_total
    FROM scoped s
    WHERE EXISTS (SELECT 1 FROM lines l WHERE l.order_id = s.id)
  ),
  per_product AS (
    SELECT
      l.product_id,
      l.product_name                                             AS name,
      l.category_id                                              AS category_id,
      l.category_name                                            AS category_name,
      SUM(l.quantity)                                            AS qty,
      SUM(l.line_total)                                          AS revenue,
      SUM(l.discount_amount)                                     AS discount,
      COUNT(DISTINCT l.order_id)                                 AS order_count,
      COALESCE(SUM(l.quantity)   FILTER (WHERE NOT l.is_b2b), 0) AS counter_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE NOT l.is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(l.quantity)   FILTER (WHERE l.is_b2b), 0)     AS b2b_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE l.is_b2b), 0)     AS b2b_revenue
    FROM lines l
    GROUP BY l.product_id, l.product_name, l.category_id, l.category_name
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'revenue',       t.revenue,
      'qty',           t.qty,
      'discount',      t.discount,
      'lines',         t.line_count,
      'orders',        t.order_count,
      'products',      t.product_count,
      'avg_price',     COALESCE(ROUND(t.revenue / NULLIF(t.qty, 0), 2), 0),
      'counter', jsonb_build_object('qty', t.counter_qty, 'revenue', t.counter_revenue),
      'b2b',     jsonb_build_object('qty', t.b2b_qty,     'revenue', t.b2b_revenue),
      'unattributed', jsonb_build_object(
        'order_discount',  u.order_discount,
        'promotion_total', u.promotion_total
      )
    ),
    'by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id',    pp.product_id,
          'name',          pp.name,
          'category_id',   pp.category_id,
          'category_name', pp.category_name,
          'qty',           pp.qty,
          'revenue',       pp.revenue,
          'discount',      pp.discount,
          'order_count',   pp.order_count,
          'avg_price',     COALESCE(ROUND(pp.revenue / NULLIF(pp.qty, 0), 2), 0),
          'share_pct',     COALESCE(ROUND(100 * pp.revenue / NULLIF(t.revenue, 0), 2), 0),
          'counter',       jsonb_build_object('qty', pp.counter_qty, 'revenue', pp.counter_revenue),
          'b2b',           jsonb_build_object('qty', pp.b2b_qty,     'revenue', pp.b2b_revenue)
        ) ORDER BY pp.revenue DESC, pp.name ASC
      ) FROM per_product pp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, unattributed u;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_product_v4(p_start_date date, p_end_date date, p_category_id uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_product_v4(p_start_date date, p_end_date date, p_category_id uuid) TO authenticated,service_role;
DROP FUNCTION public.get_sales_by_product_v2(p_start_date date, p_end_date date, p_category_id uuid);
DROP FUNCTION public.get_sales_by_product_v3(p_start_date date, p_end_date date, p_category_id uuid);
