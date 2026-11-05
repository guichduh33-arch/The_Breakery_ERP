-- Correction des conversions de lignes de vues, depuis les corps live DEV.
CREATE OR REPLACE FUNCTION public._dashboard_share_payments_v4(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_share    JSONB;
  v_payments JSONB;
BEGIN
  WITH t AS (
    SELECT o.order_type::text AS order_type,
           SUM(o.total)::NUMERIC(14,2) AS gross,
           COUNT(*)::INT AS cnt
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date = p_today
     GROUP BY o.order_type
  ),
  tot AS (SELECT COALESCE(SUM(gross), 0) AS g FROM t)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'order_type', t.order_type, 'gross', t.gross, 'order_count', t.cnt,
           'share_pct', ROUND((t.gross / NULLIF(tot.g, 0)) * 100, 1)
         ) ORDER BY t.gross DESC), '[]'::jsonb)
    INTO v_share FROM t CROSS JOIN tot;

  WITH pm AS (
    SELECT op.method::text AS method,
           SUM(op.amount)::NUMERIC(14,2) AS amount,
           COUNT(*)::INT AS cnt
      FROM reporting_private.closed_order_payments_v1 op
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
     WHERE (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
       AND ((op.paid_at AT TIME ZONE p_tz))::date = p_today
     GROUP BY op.method
  ),
  pm_tot AS (SELECT COALESCE(SUM(amount), 0) AS a FROM pm),
  drawer AS (
    SELECT COALESCE(SUM(
             s.opening_cash + s.cash_in_total - s.cash_out_total
             + COALESCE((SELECT SUM(op.amount)
                           FROM reporting_private.closed_order_payments_v1 op
                           JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
                          WHERE op.session_id = s.id
                            AND (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
                            AND op.method = 'cash'), 0)
             - COALESCE((SELECT SUM(rp.amount) FROM refund_payments rp JOIN reporting_private.closed_refunds_v1 r ON r.id=rp.refund_id JOIN reporting_private.closed_pos_orders_v1 ro ON ro.id=r.order_id
                 WHERE reporting_private.refund_payment_session_v1(ROW(r.*)::public.refunds)=s.id AND rp.method='cash' AND (NOT r.is_full_void OR ro.outstanding_at IS NOT NULL)),0)
           ), 0) AS expected
      FROM reporting_private.closed_pos_sessions_v1 s
     WHERE s.status = 'open'
  )
  SELECT jsonb_build_object(
           'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'method', pm.method, 'amount', pm.amount, 'count', pm.cnt,
                        'share_pct', ROUND((pm.amount / NULLIF(pm_tot.a, 0)) * 100, 1)
                      ) ORDER BY pm.amount DESC) FROM pm CROSS JOIN pm_tot), '[]'::jsonb),
           'total', COALESCE((SELECT SUM(amount) FROM pm), 0),
           'cash_expected_drawer', CASE WHEN public.is_business_owner_v1() THEN (SELECT expected FROM drawer) ELSE NULL END)
    INTO v_payments;

  RETURN jsonb_build_object('revenue_share', v_share, 'payments', v_payments);
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_share_payments_v4(p_tz text, p_today date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._dashboard_share_payments_v4(p_tz text, p_today date) TO service_role;
CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v6()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_today  DATE;
  v_kpis   JSONB;
  v_rev    JSONB;
  v_hourly JSONB;
  v_sp     JSONB;
  v_cost   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  v_kpis   := _dashboard_kpis_v3(v_tz, v_today);
  v_rev    := _dashboard_revenue_series_v2(v_tz, v_today);
  v_hourly := _dashboard_hourly_v2(v_tz, v_today);
  v_sp     := _dashboard_share_payments_v4(v_tz, v_today);

  IF has_permission(auth.uid(), 'reports.financial.read') THEN
    v_cost := _dashboard_cost_mtd_v3(v_tz, v_today);
  ELSE
    v_kpis := jsonb_set(v_kpis, '{gross_margin}', jsonb_build_object(
      'restricted', TRUE, 'value', NULL, 'vs_yesterday_pt', NULL,
      'vs_d7_pt', NULL, 'basis', NULL, 'cost_coverage_pct', NULL));
    v_cost := jsonb_build_object(
      'restricted', TRUE, 'cogs_total', NULL, 'opex_total', NULL,
      'sales_mtd', NULL, 'cogs_pct_of_sales', NULL, 'opex_pct_of_sales', NULL,
      'total', NULL, 'cost_per_basket', NULL, 'lines', '[]'::jsonb);
  END IF;

  IF has_permission(auth.uid(), 'accounting.cash.read') THEN
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}', _dashboard_cash_on_hand_v2());
  ELSE
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}',
                jsonb_build_object('value', NULL, 'restricted', TRUE,
                                   'wallets', '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object(
    'kpis',                v_kpis,
    'revenue_30d',         v_rev    -> 'series',
    'revenue_30d_summary', v_rev    -> 'summary',
    'hourly_sales',        v_hourly -> 'series',
    'hourly_peak',         v_hourly -> 'peak',
    'revenue_share',       v_sp     -> 'revenue_share',
    'payments',            v_sp     -> 'payments',
    'cost_mtd',            v_cost,
    'generated_at',        now()
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_dashboard_overview_v6() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v6() TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_pos_sessions_report_v4(p_start_date date, p_end_date date)
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
    SELECT reporting_private.refund_payment_session_v1(ROW(r.*)::public.refunds) AS session_id, COALESCE(SUM(r.total), 0) AS refunds_total
      FROM reporting_private.closed_refunds_v1 r
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = r.order_id
     WHERE reporting_private.refund_payment_session_v1(ROW(r.*)::public.refunds) IN (SELECT id FROM scoped) AND (NOT r.is_full_void OR o.outstanding_at IS NOT NULL)
     GROUP BY reporting_private.refund_payment_session_v1(ROW(r.*)::public.refunds)
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
REVOKE ALL ON FUNCTION public.get_pos_sessions_report_v4(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_sessions_report_v4(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_pos_sessions_report_v3(p_start_date date, p_end_date date);
DROP FUNCTION public.get_dashboard_overview_v5();
DROP FUNCTION public._dashboard_share_payments_v3(p_tz text, p_today date);
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
