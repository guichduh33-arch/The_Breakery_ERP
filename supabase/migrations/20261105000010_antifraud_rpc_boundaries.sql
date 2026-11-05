-- Corps copiés du relevé live DEV et versions bumpées atomiquement.
CREATE OR REPLACE FUNCTION public.get_customer_cohort_v2(p_cohort_month date, p_lookback_months integer DEFAULT 12)
 RETURNS TABLE(cohort_month date, months_since_signup integer, retained_customers integer, total_revenue numeric, retention_pct numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cohort_start DATE := date_trunc('month', p_cohort_month)::DATE;
  v_cohort_size  INT;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission_denied'
      USING ERRCODE = '42501', HINT = 'reports.read required';
  END IF;

  IF p_lookback_months IS NULL OR p_lookback_months < 0 OR p_lookback_months > 36 THEN
    RAISE EXCEPTION 'invalid_lookback' USING ERRCODE = '22023';
  END IF;

  -- Compute cohort size (customers who signed up in v_cohort_start month).
  SELECT COUNT(*)::INT INTO v_cohort_size
  FROM public.customers c
  WHERE c.deleted_at IS NULL
    AND date_trunc('month', c.created_at)::DATE = v_cohort_start;

  IF v_cohort_size = 0 THEN
    RETURN; -- empty set
  END IF;

  RETURN QUERY
  WITH cohort_members AS (
    SELECT c.id
    FROM public.customers c
    WHERE c.deleted_at IS NULL
      AND date_trunc('month', c.created_at)::DATE = v_cohort_start
  ),
  bucket_months AS (
    SELECT generate_series(0, p_lookback_months) AS m
  ),
  bucket_data AS (
    SELECT
      b.m AS months_since,
      (v_cohort_start + (b.m || ' months')::INTERVAL)::DATE AS bucket_start,
      (v_cohort_start + ((b.m + 1) || ' months')::INTERVAL)::DATE AS bucket_end
    FROM bucket_months b
  ),
  retained AS (
    SELECT
      bd.months_since,
      COUNT(DISTINCT o.customer_id)::INT AS retained_count,
      COALESCE(SUM(o.total), 0)::NUMERIC AS bucket_revenue
    FROM bucket_data bd
    LEFT JOIN reporting_private.closed_pos_orders_v1 o
      ON o.customer_id IN (SELECT id FROM cohort_members)
     AND o.status::TEXT IN ('completed', 'paid', 'refunded')
     AND o.created_at >= bd.bucket_start
     AND o.created_at <  bd.bucket_end
    GROUP BY bd.months_since
  )
  SELECT
    v_cohort_start                                              AS cohort_month,
    r.months_since                                              AS months_since_signup,
    r.retained_count                                            AS retained_customers,
    r.bucket_revenue                                            AS total_revenue,
    ROUND((r.retained_count::NUMERIC / v_cohort_size) * 100, 2) AS retention_pct
  FROM retained r
  ORDER BY r.months_since;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_customer_cohort_v2(p_cohort_month date, p_lookback_months integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_cohort_v2(p_cohort_month date, p_lookback_months integer) TO authenticated,service_role;
DROP FUNCTION public.get_customer_cohort_v1(p_cohort_month date, p_lookback_months integer);

CREATE OR REPLACE FUNCTION public.get_customer_segments_v2(p_segment_type text DEFAULT 'all'::text)
 RETURNS TABLE(segment text, customer_count integer, total_spent numeric, avg_orders numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_segments TEXT[] := ARRAY['champions','loyal','at_risk','new','dormant','lost'];
BEGIN
  IF NOT public.has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission_denied'
      USING ERRCODE = '42501', HINT = 'reports.read required';
  END IF;

  IF p_segment_type IS NULL THEN
    p_segment_type := 'all';
  END IF;
  IF p_segment_type NOT IN ('all','champions','loyal','at_risk','new','dormant','lost') THEN
    RAISE EXCEPTION 'invalid_segment_type' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT
      c.id,
      (SELECT coalesce(sum(v.total),0) FROM reporting_private.recognized_sales_v2 v WHERE v.customer_id=c.id) AS total_spent,
      c.created_at,
      (SELECT max(v.recognized_at) FROM reporting_private.recognized_sales_v2 v WHERE v.customer_id=c.id) AS last_visit_at,
      (SELECT count(*) FROM reporting_private.recognized_sales_v2 v WHERE v.customer_id=c.id) AS total_visits,
      EXTRACT(EPOCH FROM (now() - COALESCE((SELECT max(v.recognized_at) FROM reporting_private.recognized_sales_v2 v WHERE v.customer_id=c.id), c.created_at))) / 86400.0 AS days_since_last,
      EXTRACT(EPOCH FROM (now() - c.created_at)) / 86400.0 AS days_since_signup,
      (
        SELECT COUNT(*)::INT
        FROM reporting_private.closed_pos_orders_v1 o
        WHERE o.customer_id = c.id
          AND o.status::TEXT IN ('completed','paid','refunded')
          AND o.created_at >= now() - INTERVAL '90 days'
      ) AS freq_90d
    FROM public.customers c
    WHERE c.deleted_at IS NULL
  ),
  classified AS (
    SELECT
      s.*,
      CASE
        WHEN s.days_since_last <= 14 AND s.freq_90d >= 5 AND s.total_spent >= 1000000
          THEN 'champions'
        WHEN s.days_since_last <= 30 AND s.freq_90d >= 3
          THEN 'loyal'
        WHEN s.days_since_signup <= 30 AND s.freq_90d >= 1
          THEN 'new'
        WHEN s.days_since_last BETWEEN 31 AND 60 AND s.total_visits >= 3
          THEN 'at_risk'
        WHEN s.days_since_last BETWEEN 61 AND 180
          THEN 'dormant'
        WHEN s.days_since_last > 180
            OR (s.last_visit_at IS NULL AND s.days_since_signup > 60)
          THEN 'lost'
        ELSE 'lost'
      END AS seg
    FROM stats s
  ),
  bucket_template AS (
    SELECT unnest(v_segments) AS seg
  )
  SELECT
    bt.seg                                                    AS segment,
    COUNT(cl.id)::INT                                         AS customer_count,
    COALESCE(SUM(cl.total_spent), 0)::NUMERIC                 AS total_spent,
    ROUND(COALESCE(AVG(cl.freq_90d), 0)::NUMERIC, 2)          AS avg_orders
  FROM bucket_template bt
  LEFT JOIN classified cl ON cl.seg = bt.seg
  WHERE p_segment_type = 'all' OR bt.seg = p_segment_type
  GROUP BY bt.seg
  ORDER BY
    CASE bt.seg
      WHEN 'champions' THEN 1 WHEN 'loyal'    THEN 2 WHEN 'new'    THEN 3
      WHEN 'at_risk'   THEN 4 WHEN 'dormant'  THEN 5 WHEN 'lost'   THEN 6
      ELSE 99 END;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_customer_segments_v2(p_segment_type text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_segments_v2(p_segment_type text) TO authenticated,service_role;
DROP FUNCTION public.get_customer_segments_v1(p_segment_type text);

CREATE FUNCTION public.can_view_business_day_v2(p_day date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.can_view_stock_v1()
$$;
REVOKE ALL ON FUNCTION public.can_view_business_day_v2(p_day date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_business_day_v2(p_day date) TO authenticated,service_role;
ALTER POLICY confidentiality_pos_events ON public.pos_events USING(can_view_business_day_v2((occurred_at)::date));
ALTER POLICY confidentiality_audit_logs ON public.audit_logs USING(can_view_business_day_v2((created_at)::date));
ALTER POLICY confidentiality_stock_movements ON public.stock_movements USING(can_view_business_day_v2((created_at)::date));
ALTER POLICY confidentiality_notifications ON public.notification_outbox USING(can_view_business_day_v2((created_at)::date));
ALTER POLICY confidentiality_display_stock ON public.display_stock USING(can_view_business_day_v2(CURRENT_DATE));
ALTER POLICY confidentiality_display_movements ON public.display_movements USING(can_view_business_day_v2((created_at)::date));
ALTER POLICY confidentiality_zreports ON public.z_reports USING((EXISTS ( SELECT 1
   FROM pos_sessions s
  WHERE ((s.id = z_reports.shift_id) AND can_view_business_day_v2((s.opened_at)::date)))));
DROP FUNCTION public.can_view_business_day_v1(p_day date);

CREATE FUNCTION public.assert_business_days_visible_v2(p_start date,p_end date) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end THEN
  RAISE EXCEPTION 'invalid_date_range' USING ERRCODE='22023'; END IF;
 IF public.is_business_owner_v1() THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d(day)
  WHERE NOT public.can_view_sales_day_v1(d.day::date)) THEN
  RAISE EXCEPTION 'business_day_not_closed' USING ERRCODE='P0003'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_business_days_visible_v2(p_start date, p_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_business_days_visible_v2(p_start date, p_end date) TO service_role;
DROP FUNCTION public.assert_business_days_visible_v1(p_start date, p_end date);

CREATE FUNCTION public.can_view_order_v2(p_order_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.orders o WHERE o.id=p_order_id AND (
  public.is_business_owner_v1() OR o.order_type='b2b'
  OR public.can_view_sales_day_v1(coalesce(o.outstanding_at,o.paid_at,o.created_at)::date)
  OR (public.get_current_role()<>'ADMIN' AND (
   o.status::text IN('draft','pending_payment','b2b_pending')
   OR (o.status::text='paid' AND EXISTS(SELECT 1 FROM public.order_items oi
    WHERE oi.order_id=o.id AND NOT coalesce(oi.is_cancelled,false)
    AND oi.served_at IS NULL AND oi.kitchen_status IN('pending','preparing','ready')
    AND coalesce(oi.dispatch_station,'none')<>'none'))))))
$$;
REVOKE ALL ON FUNCTION public.can_view_order_v2(p_order_id uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_order_v2(p_order_id uuid) TO authenticated,service_role;
ALTER POLICY confidentiality_cancel_replays ON public.unpaid_order_cancel_keys USING(can_view_order_v2(order_id));
ALTER POLICY confidentiality_finished_orders ON public.orders USING(can_view_order_v2(id));
ALTER POLICY confidentiality_order_items ON public.order_items USING(can_view_order_v2(order_id));
ALTER POLICY confidentiality_promotions ON public.promotion_applications USING(can_view_order_v2(order_id));
ALTER POLICY confidentiality_refund_lines ON public.refund_lines USING((EXISTS ( SELECT 1
   FROM refunds r
  WHERE ((r.id = refund_lines.refund_id) AND can_view_order_v2(r.order_id)))));
ALTER POLICY confidentiality_order_replays ON public.order_edit_idempotency_keys USING(can_view_order_v2(order_id));
DROP FUNCTION public.can_view_order_v1(p_order_id uuid);

CREATE OR REPLACE FUNCTION public.get_business_day_visibility_v2(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_release business_day_releases%ROWTYPE;
BEGIN
 IF get_current_profile_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 SELECT * INTO v_release FROM business_day_releases WHERE day=p_day;
 RETURN jsonb_build_object('day',p_day,'released',v_release.day IS NOT NULL,
   'can_view_sales',can_view_sales_day_v1(p_day),'is_owner',is_business_owner_v1(),
   'activated_on',(SELECT activated_on FROM business_day_visibility_config WHERE id),
   'released_at',v_release.released_at,'count_id',v_release.count_id);
END $function$
;
REVOKE ALL ON FUNCTION public.get_business_day_visibility_v2(p_day date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_business_day_visibility_v2(p_day date) TO authenticated,service_role;
DROP FUNCTION public.get_business_day_visibility_v1(p_day date);

CREATE OR REPLACE FUNCTION public.get_operational_products_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_visible boolean;
BEGIN
 IF NOT is_authenticated() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003'; END IF;
 v_visible:=public.can_view_stock_v1();
 RETURN COALESCE((SELECT jsonb_agg(
   (to_jsonb(p)-'current_stock')||jsonb_build_object(
    'current_stock',CASE WHEN v_visible THEN p.current_stock ELSE NULL END,
    'categories',CASE WHEN c.id IS NOT NULL THEN to_jsonb(c) ELSE NULL END,
    'display_stock',CASE WHEN ds.product_id IS NULL THEN NULL ELSE
       jsonb_build_object('quantity',CASE WHEN v_visible THEN ds.quantity ELSE NULL END) END,
    'is_sellable',CASE WHEN NOT COALESCE(p.track_inventory,true) THEN true
       ELSE COALESCE(ds.quantity,p.current_stock,0)>0 END,
    'has_variants',EXISTS(SELECT 1 FROM products v WHERE v.parent_product_id=p.id
        AND v.is_active AND v.deleted_at IS NULL))
   ORDER BY p.name,p.id)
 FROM products p LEFT JOIN categories c ON c.id=p.category_id
 LEFT JOIN display_stock ds ON ds.product_id=p.id
 WHERE p.deleted_at IS NULL AND
   (NOT has_permission(auth.uid(),'inventory.production.kitchen')
     OR has_permission(auth.uid(),'products.read') OR has_permission(auth.uid(),'inventory.read'))),'[]'::jsonb);
END $function$
;
REVOKE ALL ON FUNCTION public.get_operational_products_v2() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_operational_products_v2() TO authenticated,service_role;
DROP FUNCTION public.get_operational_products_v1();

CREATE OR REPLACE FUNCTION public.get_cash_flow_v4(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_net_profit       NUMERIC(14,2) := 0;
  v_revenue          NUMERIC(14,2) := 0;
  v_cogs             NUMERIC(14,2) := 0;
  v_opex             NUMERIC(14,2) := 0;
  v_delta_ar         NUMERIC(14,2) := 0;
  v_delta_ap         NUMERIC(14,2) := 0;
  v_delta_inv        NUMERIC(14,2) := 0;
  v_other            NUMERIC(14,2) := 0;
  v_operating_total  NUMERIC(14,2) := 0;
  v_investing_total  NUMERIC(14,2) := 0;
  v_financing_total  NUMERIC(14,2) := 0;
  v_cash_start       NUMERIC(14,2) := 0;
  v_cash_end         NUMERIC(14,2) := 0;
  v_net_change       NUMERIC(14,2) := 0;
  v_prior_end        DATE;
BEGIN
  PERFORM public.assert_stock_owner_v1();
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_cash_flow_v3: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_cash_flow_v3: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  v_prior_end := (p_date_start - INTERVAL '1 day')::DATE;

  SELECT
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'operating' THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'investing' THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'financing' THEN (jel.credit - jel.debit) END), 0)
  INTO v_operating_total, v_investing_total, v_financing_total
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND a.cash_flow_section <> 'none';

  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '113%' THEN -(jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '114%' THEN -(jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2141'    THEN  (jel.credit - jel.debit) END), 0)
  INTO v_revenue, v_cogs, v_opex, v_delta_ar, v_delta_inv, v_delta_ap
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  v_net_profit := (v_revenue - v_cogs - v_opex)::NUMERIC(14,2);

  v_other := (v_operating_total
              - (v_net_profit + v_delta_ar + v_delta_ap + v_delta_inv))::NUMERIC(14,2);

  SELECT
    COALESCE(SUM(CASE WHEN je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(jel.debit - jel.credit), 0)
  INTO v_cash_start, v_cash_end
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date <= p_date_end
    AND a.cash_flow_section = 'none';

  v_net_change := (v_operating_total + v_investing_total + v_financing_total)::NUMERIC(14,2);

  RETURN jsonb_build_object(
    'operating', jsonb_build_object(
      'net_profit',           v_net_profit,
      'delta_ar',             v_delta_ar,
      'delta_ap',             v_delta_ap,
      'delta_inventory',      v_delta_inv,
      'non_cash_adjustments', v_other,
      'total',                v_operating_total
    ),
    'investing', jsonb_build_object('total', v_investing_total),
    'financing', jsonb_build_object('total', v_financing_total),
    'net_change_in_cash', v_net_change,
    'cash_start',         v_cash_start,
    'cash_end',           v_cash_end,
    'period', jsonb_build_object(
      'start', p_date_start,
      'end',   p_date_end
    )
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_cash_flow_v4(p_date_start date, p_date_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_flow_v4(p_date_start date, p_date_end date) TO authenticated,service_role;
DROP FUNCTION public.get_cash_flow_v3(p_date_start date, p_date_end date);
