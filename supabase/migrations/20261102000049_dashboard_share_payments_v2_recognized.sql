-- Corps production relevé par pg_get_functiondef ; ancien contrat conservé pendant la transition.
CREATE OR REPLACE FUNCTION public._dashboard_share_payments_v2(p_tz text, p_today date)
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
      FROM reporting_private.recognized_sales_v1 o
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
      FROM order_payments op
      JOIN orders o ON o.id = op.order_id
     WHERE (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
       AND ((op.paid_at AT TIME ZONE p_tz))::date = p_today
     GROUP BY op.method
  ),
  pm_tot AS (SELECT COALESCE(SUM(amount), 0) AS a FROM pm),
  drawer AS (
    SELECT COALESCE(SUM(
             s.opening_cash + s.cash_in_total - s.cash_out_total
             + COALESCE((SELECT SUM(op.amount)
                           FROM order_payments op
                           JOIN orders o ON o.id = op.order_id
                          WHERE op.session_id = s.id
                            AND (o.status<>'voided' OR o.outstanding_at IS NOT NULL)
                            AND op.method = 'cash'), 0)
             - COALESCE((SELECT SUM(rp.amount) FROM refund_payments rp JOIN refunds r ON r.id=rp.refund_id JOIN orders ro ON ro.id=r.order_id
                 WHERE reporting_private.refund_payment_session_v1(r)=s.id AND rp.method='cash' AND (NOT r.is_full_void OR ro.outstanding_at IS NOT NULL)),0)
           ), 0) AS expected
      FROM pos_sessions s
     WHERE s.status = 'open'
  )
  SELECT jsonb_build_object(
           'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                        'method', pm.method, 'amount', pm.amount, 'count', pm.cnt,
                        'share_pct', ROUND((pm.amount / NULLIF(pm_tot.a, 0)) * 100, 1)
                      ) ORDER BY pm.amount DESC) FROM pm CROSS JOIN pm_tot), '[]'::jsonb),
           'total', COALESCE((SELECT SUM(amount) FROM pm), 0),
           'cash_expected_drawer', (SELECT expected FROM drawer))
    INTO v_payments;

  RETURN jsonb_build_object('revenue_share', v_share, 'payments', v_payments);
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_share_payments_v2(p_tz text, p_today date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._dashboard_share_payments_v2(p_tz text, p_today date) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
