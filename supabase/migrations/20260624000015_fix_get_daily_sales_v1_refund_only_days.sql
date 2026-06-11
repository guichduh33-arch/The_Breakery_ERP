-- 20260624000015_fix_get_daily_sales_v1_refund_only_days.sql
-- S40 corrective (DEV-S40-A1-01) — refunds created on a day with no orders were
-- silently dropped: the days CTE started FROM valid_orders LEFT JOIN day_refunds,
-- so refund-only days never appeared and summary.refund_total under-counted.
-- Caught by pgTAP T5 (refund seeded on CURRENT_DATE, orders on D-1/D-2).
-- Fix: aggregate orders per day first, then FULL OUTER JOIN with refunds per day.
-- Shape unchanged; refund-only days now emit by_day rows with order_count=0.

CREATE OR REPLACE FUNCTION public.get_daily_sales_v1(
  p_date_start TEXT,
  p_date_end   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start   DATE;
  v_end     DATE;
  v_tz      TEXT;
  v_summary JSONB;
  v_by_day  JSONB;
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
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH valid_orders AS (
    SELECT o.id,
           o.total,
           ((o.paid_at AT TIME ZONE v_tz))::date AS day
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  day_orders AS (
    SELECT vo.day,
           COUNT(*)::INT                AS order_count,
           SUM(vo.total)::NUMERIC(14,2) AS gross
      FROM valid_orders vo
     GROUP BY vo.day
  ),
  day_refunds AS (
    SELECT ((r.created_at AT TIME ZONE v_tz))::date AS day,
           SUM(r.total) AS refund_total
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     GROUP BY 1
  ),
  days AS (
    SELECT COALESCE(o.day, r.day)                        AS day,
           COALESCE(o.order_count, 0)                    AS order_count,
           COALESCE(o.gross, 0)::NUMERIC(14,2)           AS gross,
           COALESCE(r.refund_total, 0)::NUMERIC(14,2)    AS refunds
      FROM day_orders o
      FULL OUTER JOIN day_refunds r ON r.day = o.day
  )
  SELECT
    jsonb_build_object(
      'total',        COALESCE(SUM(gross), 0),
      'order_count',  COALESCE(SUM(order_count), 0),
      'aov',          CASE WHEN COALESCE(SUM(order_count), 0) = 0 THEN 0
                           ELSE ROUND(SUM(gross) / SUM(order_count), 2) END,
      'refund_total', COALESCE(SUM(refunds), 0),
      'net',          COALESCE(SUM(gross), 0) - COALESCE(SUM(refunds), 0)
    ),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'date',        day,
        'order_count', order_count,
        'gross',       gross,
        'refunds',     refunds,
        'net',         gross - refunds,
        'aov',         CASE WHEN order_count = 0 THEN 0 ELSE ROUND(gross / order_count, 2) END
      ) ORDER BY day
    ), '[]'::jsonb)
  INTO v_summary, v_by_day
  FROM days;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', v_start, 'end', v_end),
    'summary', v_summary,
    'by_day',  v_by_day
  );
END;
$$;

COMMENT ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) IS
  'S40 — daily sales breakdown (gross/refunds/net/AOV per day). Refund-only days '
  'included via FULL OUTER JOIN (corrective _015). Gate reports.sales.read.';

-- REVOKE pair re-asserted (CREATE OR REPLACE preserves ACLs, defense-in-depth)
REVOKE ALL ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_daily_sales_v1(TEXT, TEXT) TO authenticated;
