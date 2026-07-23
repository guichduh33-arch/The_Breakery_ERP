-- 20260723000215_get_payments_by_method_v3_fees_wallets.sql
-- ADR-006 déc. 9 (lot C) — get_payments_by_method_v3 :
--   1. by_method : + fee_pct / fee_est / net_est par ligne, calculés depuis
--      business_config.payment_method_fees (_212) — INFORMATIF, aucun JE.
--   2. summary : + total_fees_est / total_net_est.
--   3. by_day : colonnes gopay/ovo/dana (lot B les laissait dans `other`).
-- Corps repris du live v2 (pg_get_functiondef, session du 2026-07-23) ;
-- versioning monotone : v2 droppée dans la même migration.

CREATE FUNCTION public.get_payments_by_method_v3(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_tz            TEXT;
  v_start         TIMESTAMPTZ;
  v_end           TIMESTAMPTZ;
  v_total_amount  NUMERIC(15,2);
  v_total_count   INT;
  v_total_orders  INT;
  v_fees          JSONB;
  v_total_fees    NUMERIC(15,2);
  v_by_method     JSONB;
  v_by_day        JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  -- Lot C : frais informatifs par méthode ({"<method>": <percent>}).
  SELECT payment_method_fees INTO v_fees
    FROM business_config WHERE id = 1;
  v_fees := COALESCE(v_fees, '{}'::jsonb);

  -- Local calendar-day bounds converted back to an absolute instant range,
  -- so the BETWEEN below still short-circuits on the paid_at index.
  v_start := (p_date_start || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end   := ((p_date_end::date + 1) || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at,
           ((op.paid_at AT TIME ZONE v_tz))::date AS local_day
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(SUM(amount), 0), COUNT(*), COUNT(DISTINCT order_id)
  INTO v_total_amount, v_total_count, v_total_orders
  FROM valid_payments;

  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at,
           ((op.paid_at AT TIME ZONE v_tz))::date AS local_day
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.amount DESC), '[]'::jsonb)
  INTO v_by_method
  FROM (
    SELECT
      method::text AS method,
      SUM(amount)  AS amount,
      COUNT(*)     AS count,
      CASE WHEN v_total_amount = 0 THEN 0
           ELSE ROUND((SUM(amount) / v_total_amount) * 100, 2)
      END AS share_pct,
      COALESCE((v_fees ->> method::text)::NUMERIC, 0) AS fee_pct,
      ROUND(SUM(amount) * COALESCE((v_fees ->> method::text)::NUMERIC, 0) / 100, 2) AS fee_est,
      SUM(amount)
        - ROUND(SUM(amount) * COALESCE((v_fees ->> method::text)::NUMERIC, 0) / 100, 2) AS net_est
    FROM valid_payments
    GROUP BY method
  ) t;

  SELECT COALESCE(SUM((e ->> 'fee_est')::NUMERIC), 0) INTO v_total_fees
  FROM jsonb_array_elements(v_by_method) e;

  -- by_day pivot — 9 named methods + `other` (catch-all) so columns reconcile to total.
  -- day = LOCAL calendar day (business_config.timezone), not UTC.
  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at,
           ((op.paid_at AT TIME ZONE v_tz))::date AS local_day
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      local_day AS day,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'cash'),         0) AS cash,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'card'),         0) AS card,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'qris'),         0) AS qris,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'edc'),          0) AS edc,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'transfer'),     0) AS transfer,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'store_credit'), 0) AS store_credit,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'gopay'),        0) AS gopay,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'ovo'),          0) AS ovo,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'dana'),         0) AS dana,
      COALESCE(SUM(amount) FILTER (WHERE method::text NOT IN
        ('cash','card','qris','edc','transfer','store_credit','gopay','ovo','dana')), 0) AS other,
      SUM(amount) AS total
    FROM valid_payments
    GROUP BY local_day
  ) t;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'summary', jsonb_build_object(
      'total_amount',   v_total_amount,
      'total_count',    v_total_count,
      'total_orders',   v_total_orders,
      'total_fees_est', v_total_fees,
      'total_net_est',  v_total_amount - v_total_fees
    ),
    'by_method', v_by_method,
    'by_day',    v_by_day
  );
END;
$function$;

-- Versioning monotone : v2 droppée dans la même migration.
DROP FUNCTION public.get_payments_by_method_v2(text, text);

-- Grants — miroir de v2 (gate applicatif reports.financial.read in-body).
REVOKE EXECUTE ON FUNCTION public.get_payments_by_method_v3(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_payments_by_method_v3(text, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_payments_by_method_v3(text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_payments_by_method_v3(text, text) IS
  'Bump of get_payments_by_method_v2 (lot C ADR-006 dec. 9): per-line '
  'fee_pct/fee_est/net_est from business_config.payment_method_fees '
  '(informational, no JE), summary total_fees_est/total_net_est, and '
  'gopay/ovo/dana columns in the by_day pivot (out of `other`).';
