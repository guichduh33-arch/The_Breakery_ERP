-- S70 (fiche 12 D2.4) — Cashier cash/QRIS/card variance report.
-- Read-only aggregation over closed shifts, grouped by pos_sessions.opened_by.
-- Cash variance = frozen pos_sessions.variance_total; QRIS/card variance =
-- frozen audit_logs 'shift.close' metadata (no recompute → stable over time).
-- Gated reports.read. No writes. Money-path untouched.

CREATE OR REPLACE FUNCTION public.get_cashier_variance_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_cashiers JSONB;
  v_totals   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  -- Normalized per-session rows for the window (shared shape below).
  WITH sessions AS (
    SELECT
      ps.opened_by                                           AS cashier_id,
      ps.variance_total                                      AS cash_var,
      ps.counted_qris                                        AS counted_qris,
      ps.counted_card                                        AS counted_card,
      CASE WHEN ps.counted_qris IS NOT NULL
           THEN (sc.metadata->>'variance_qris')::numeric END AS qris_var,
      CASE WHEN ps.counted_card IS NOT NULL
           THEN (sc.metadata->>'variance_card')::numeric END AS card_var,
      EXTRACT(DOW FROM (ps.closed_at AT TIME ZONE v_tz))::int AS dow
    FROM pos_sessions ps
    LEFT JOIN LATERAL (
      SELECT al.metadata
        FROM audit_logs al
       WHERE al.action = 'shift.close'
         AND al.entity_type = 'pos_sessions'
         AND al.entity_id = ps.id
       ORDER BY al.created_at DESC
       LIMIT 1
    ) sc ON TRUE
    WHERE ps.status = 'closed'
      AND ps.closed_at IS NOT NULL
      AND ps.opened_by IS NOT NULL
      AND ((ps.closed_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  per_cashier AS (
    SELECT
      s.cashier_id,
      COUNT(*)                                                   AS sessions_count,
      COALESCE(SUM(s.cash_var), 0)                               AS cash_total,
      COALESCE(SUM(s.cash_var) FILTER (WHERE s.cash_var < 0), 0) AS cash_short,
      COUNT(*) FILTER (WHERE s.cash_var < 0)                     AS short_count,
      COUNT(*) FILTER (WHERE s.cash_var > 0)                     AS over_count,
      COALESCE(MIN(s.cash_var), 0)                               AS worst_var,
      COUNT(*) FILTER (WHERE s.counted_qris IS NOT NULL)         AS qris_sessions,
      COALESCE(SUM(s.qris_var), 0)                               AS qris_total,
      COUNT(*) FILTER (WHERE s.counted_card IS NOT NULL)         AS card_sessions,
      COALESCE(SUM(s.card_var), 0)                               AS card_total
    FROM sessions s
    GROUP BY s.cashier_id
  ),
  dow_by_cashier AS (
    SELECT d.cashier_id,
           jsonb_agg(jsonb_build_object(
             'dow', d.dow, 'sessions', d.sessions, 'total_variance', d.total_variance
           ) ORDER BY d.dow) AS dow_cash
    FROM (
      SELECT s.cashier_id, s.dow,
             COUNT(*) AS sessions,
             COALESCE(SUM(s.cash_var), 0) AS total_variance
        FROM sessions s
       GROUP BY s.cashier_id, s.dow
    ) d
    GROUP BY d.cashier_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'cashier_id',     pc.cashier_id,
      'cashier_name',   COALESCE(up.full_name, '—'),
      'sessions_count', pc.sessions_count,
      'cash', jsonb_build_object(
        'total_variance', pc.cash_total,
        'avg_variance',   ROUND(pc.cash_total / NULLIF(pc.sessions_count, 0), 2),
        'total_short',    pc.cash_short,
        'short_count',    pc.short_count,
        'over_count',     pc.over_count,
        'worst_variance', pc.worst_var
      ),
      'qris', jsonb_build_object('counted_sessions', pc.qris_sessions, 'total_variance', pc.qris_total),
      'card', jsonb_build_object('counted_sessions', pc.card_sessions, 'total_variance', pc.card_total),
      'dow_cash', COALESCE(dc.dow_cash, '[]'::jsonb)
    ) ORDER BY pc.cash_short ASC
  )
  INTO v_cashiers
  FROM per_cashier pc
  JOIN user_profiles up ON up.id = pc.cashier_id
  LEFT JOIN dow_by_cashier dc ON dc.cashier_id = pc.cashier_id;

  -- Grand totals over the same window.
  WITH sessions AS (
    SELECT ps.variance_total AS cash_var, ps.counted_qris, ps.counted_card,
           CASE WHEN ps.counted_qris IS NOT NULL THEN (sc.metadata->>'variance_qris')::numeric END AS qris_var,
           CASE WHEN ps.counted_card IS NOT NULL THEN (sc.metadata->>'variance_card')::numeric END AS card_var
      FROM pos_sessions ps
      LEFT JOIN LATERAL (
        SELECT al.metadata FROM audit_logs al
         WHERE al.action = 'shift.close' AND al.entity_type = 'pos_sessions' AND al.entity_id = ps.id
         ORDER BY al.created_at DESC LIMIT 1
      ) sc ON TRUE
     WHERE ps.status = 'closed' AND ps.closed_at IS NOT NULL AND ps.opened_by IS NOT NULL
       AND ((ps.closed_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  )
  SELECT jsonb_build_object(
    'sessions_count', COUNT(*),
    'cash', jsonb_build_object(
      'total_variance', COALESCE(SUM(cash_var), 0),
      'total_short',    COALESCE(SUM(cash_var) FILTER (WHERE cash_var < 0), 0),
      'short_count',    COUNT(*) FILTER (WHERE cash_var < 0),
      'over_count',     COUNT(*) FILTER (WHERE cash_var > 0)
    ),
    'qris', jsonb_build_object('counted_sessions', COUNT(*) FILTER (WHERE counted_qris IS NOT NULL), 'total_variance', COALESCE(SUM(qris_var), 0)),
    'card', jsonb_build_object('counted_sessions', COUNT(*) FILTER (WHERE counted_card IS NOT NULL), 'total_variance', COALESCE(SUM(card_var), 0))
  ) INTO v_totals
  FROM sessions;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'cashiers',     COALESCE(v_cashiers, '[]'::jsonb),
    'totals',       COALESCE(v_totals, jsonb_build_object('sessions_count', 0))
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cashier_variance_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashier_variance_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_cashier_variance_v1(date, date) IS
  'S70 fiche 12 D2.4 — read-only cashier cash/QRIS/card variance aggregation by opened_by over a date range; gated reports.read. No writes.';
