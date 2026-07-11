-- Reports POS refonte (Lot D) — server-side Sessions / Z-report over a range.
-- Replaces the client-side "Session Open N ≠ Session Close M" counters of the
-- Activity tab with a real per-drawer lifecycle: one row per pos_session,
-- anchored on its opening WITA business date, showing status (open/closed),
-- cashier, close operator, opening float, live drawer sales, and the FROZEN
-- 3-way reconciliation (cash/QRIS/card expected·counted·variance) read from the
-- 'shift.close' audit_logs metadata — same source as S70's cashier-variance
-- report, so figures are stable even if orders are voided after close.
--   * sales / order_count / refunds / voids are live drawer aggregates
--     (same scope as _build_zreport_snapshot: orders on the session, voided
--     split out), which is intrinsic to a shift report.
--   * reconciliation is frozen: closed sessions read audit metadata; open
--     sessions expose nulls (pending close). Pre-S67 sessions may lack the
--     QRIS/card volets (NULL) — surfaced as "not counted".
-- Gated reports.sales.read (mirrors the POS route gate). Read-only, no writes.
-- Money-path untouched.

CREATE OR REPLACE FUNCTION public.get_pos_sessions_report_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_sessions JSONB;
  v_summary  JSONB;
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

  -- Sessions whose OPENING business day (WITA) falls in the window → one row per
  -- drawer lifecycle. Latest 'shift.close' audit metadata joined per session for
  -- the frozen reconciliation; live drawer aggregates joined per session.
  WITH scoped AS (
    SELECT ps.*
      FROM pos_sessions ps
     WHERE ((ps.opened_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  order_agg AS (
    SELECT o.session_id,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'voided'), 0) AS sales_total,
           COUNT(*)              FILTER (WHERE o.status::text <> 'voided')     AS order_count,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text =  'voided'), 0) AS voids_total
      FROM orders o
     WHERE o.session_id IN (SELECT id FROM scoped)
     GROUP BY o.session_id
  ),
  refund_agg AS (
    SELECT o.session_id, COALESCE(SUM(r.total), 0) AS refunds_total
      FROM refunds r
      JOIN orders o ON o.id = r.order_id
     WHERE o.session_id IN (SELECT id FROM scoped)
     GROUP BY o.session_id
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
      COALESCE(oa.sales_total, 0)                          AS sales_total,
      COALESCE(oa.order_count, 0)                          AS order_count,
      COALESCE(ra.refunds_total, 0)                        AS refunds_total,
      COALESCE(oa.voids_total, 0)                          AS voids_total,
      -- Frozen reconciliation (audit metadata) with column fallback for cash.
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

  -- Summary rollup over the same window.
  WITH scoped AS (
    SELECT ps.id, ps.status::text AS status
      FROM pos_sessions ps
     WHERE ((ps.opened_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  order_agg AS (
    SELECT o.session_id,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text <> 'voided'), 0) AS sales_total,
           COALESCE(SUM(o.total) FILTER (WHERE o.status::text =  'voided'), 0) AS voids_total
      FROM orders o
     WHERE o.session_id IN (SELECT id FROM scoped)
     GROUP BY o.session_id
  ),
  cash_close AS (
    SELECT ps.id,
           COALESCE((sc.metadata->>'variance')::numeric, ps.variance_total) AS cash_variance
      FROM pos_sessions ps
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
    'sales_total',          (SELECT COALESCE(SUM(sales_total), 0) FROM order_agg),
    'voids_total',          (SELECT COALESCE(SUM(voids_total), 0) FROM order_agg),
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
$function$;

REVOKE ALL ON FUNCTION public.get_pos_sessions_report_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_sessions_report_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_sessions_report_v1(date, date) IS
  'POS reports Sessions/Z-report over a WITA range: one row per pos_session (anchored on opening day) with status, cashier, close operator, opening float, live drawer sales/refunds/voids, and frozen 3-way reconciliation (cash/QRIS/card) from shift.close audit metadata. Summary rollup incl. open/closed counts + cash variance totals. Gated reports.sales.read. Read-only.';
