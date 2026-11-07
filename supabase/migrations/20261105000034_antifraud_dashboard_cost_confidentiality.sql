-- Le bloc coûts contient les pertes et écarts valorisés du compte de résultat.
CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v7()
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

  IF public.can_view_stock_v1() AND has_permission(auth.uid(), 'reports.financial.read') THEN
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
REVOKE ALL ON FUNCTION public.get_dashboard_overview_v7() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_overview_v7() TO authenticated,service_role;
DROP FUNCTION public.get_dashboard_overview_v6();
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
