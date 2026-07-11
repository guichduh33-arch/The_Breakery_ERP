-- Reports POS refonte (Lot G) — sales-event activity timeline (server-side).
-- Order-level events over the SAME order scope as the Overview (Lot A):
--   status IN (paid,completed), non-B2B, non-historical, no test-product line,
--   WITA business date (paid_at ?? created_at). One 'sale' event per in-scope
--   order, newest first. Session open/close events were intentionally dropped in
--   Lot D — the drawer lifecycle now lives in the Sessions tab.
-- Capped at the 500 most-recent events to bound the payload (a monthly range can
-- span thousands of tickets); `total_events` reports the true in-scope count and
-- `truncated` flags when the cap elided older events. Gated reports.sales.read.
-- Read-only, money-path untouched.

CREATE OR REPLACE FUNCTION public.get_pos_activity_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_total  INTEGER;
  v_events JSONB;
  c_cap    CONSTANT INTEGER := 500;
BEGIN
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
    SELECT
      o.id,
      o.order_number,
      o.total,
      COALESCE(o.paid_at, o.created_at) AS at
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  ),
  capped AS (
    SELECT * FROM scoped ORDER BY at DESC LIMIT c_cap
  )
  SELECT
    (SELECT COUNT(*)::int FROM scoped),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',        'order-' || c.id::text,
        'kind',      'sale',
        'reference', c.order_number,
        'amount',    c.total,
        'at',        c.at,
        'label',     'Sale completed'
      ) ORDER BY c.at DESC
    ), '[]'::jsonb)
  INTO v_total, v_events
  FROM capped c;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'total_events', v_total,
    'truncated',    v_total > c_cap,
    'events',       v_events
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_activity_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_activity_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_activity_v1(date, date) IS
  'POS reports sales-event activity timeline (one sale event per in-scope order, newest first, capped 500) over a WITA range; same order scope as the Overview; gated reports.sales.read. Read-only.';
