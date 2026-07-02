-- 20260710000094_bump_get_payments_by_method_v2_timezone.sql
-- S57 Chantier B (B-D4) — fix hardcoded-UTC bucketing in Payment-by-Method.
--
-- v1 (20260524231049, bumped 20260602130010) bucketed on RAW UTC:
--   v_start/v_end built from p_date_start||'T00:00:00Z' / p_date_end||'T23:59:59Z'
--   by_day pivot grouped by DATE(paid_at) — both UTC, not local business day.
-- Canonical tz pattern (get_daily_sales_v1, 20260624000011): read
-- business_config.timezone (default 'Asia/Makassar'), bucket on
-- (paid_at AT TIME ZONE v_tz)::date. Same fix applied here — signature
-- unchanged (TEXT, TEXT) but semantics changed → version bump per project
-- convention (never edit a published _vN body silently).
--
-- DROP v1 in same migration. GRANT/REVOKE identical to v1.
--
-- NOTE for callers: apps/backoffice/src/features/reports/hooks/usePaymentsByMethod.ts
-- is the only app call-site (repointed by a parallel agent, Vague 2 — NOT this migration).
-- supabase/tests/bakery_reports.test.sql (T4/T5/T6) and
-- supabase/tests/m9_reports_hardening.test.sql (T2) call get_payments_by_method_v1
-- directly and are updated to _v2 in the same commit as this migration (function
-- would otherwise not exist post-DROP). No generate-pdf EF caller found (grepped
-- supabase/functions — zreport.ts's totals_by_payment_method is an unrelated
-- Z-report snapshot field, not this RPC).

DROP FUNCTION IF EXISTS public.get_payments_by_method_v1(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.get_payments_by_method_v2(p_date_start TEXT, p_date_end TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_tz            TEXT;
  v_start         TIMESTAMPTZ;
  v_end           TIMESTAMPTZ;
  v_total_amount  NUMERIC(15,2);
  v_total_count   INT;
  v_total_orders  INT;
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
      END AS share_pct
    FROM valid_payments
    GROUP BY method
  ) t;

  -- by_day pivot — 6 named methods + `other` (catch-all) so columns reconcile to total.
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
      COALESCE(SUM(amount) FILTER (WHERE method::text NOT IN
        ('cash','card','qris','edc','transfer','store_credit')),         0) AS other,
      SUM(amount) AS total
    FROM valid_payments
    GROUP BY local_day
  ) t;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'summary', jsonb_build_object(
      'total_amount', v_total_amount,
      'total_count',  v_total_count,
      'total_orders', v_total_orders
    ),
    'by_method', v_by_method,
    'by_day',    v_by_day
  );
END;
$$;

-- ACL identical to v1 (vérifiée live : proacl = {postgres=X, authenticated=X, service_role=X}).
-- Le GRANT authenticated DOIT être explicite (défauts S20 : REVOKE FROM PUBLIC sur les fonctions).
REVOKE EXECUTE ON FUNCTION public.get_payments_by_method_v2(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payments_by_method_v2(TEXT, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_payments_by_method_v2(TEXT, TEXT) IS
  'S57 B-D4 : Payment by Method v2 — bucketing fixed to business_config.timezone '
  '(default Asia/Makassar), was hardcoded UTC in v1. summary + by_method (share_pct) '
  '+ by_day pivot (6 methods + other catch-all + total, reconciles by construction, '
  'day = local calendar day). Excludes voided orders.';
