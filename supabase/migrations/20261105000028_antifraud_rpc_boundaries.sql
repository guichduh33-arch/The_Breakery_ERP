-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_balance_sheet_v4(p_as_of_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assets_cash NUMERIC(14,2):=0; v_assets_ar NUMERIC(14,2):=0; v_assets_inv NUMERIC(14,2):=0; v_assets_other NUMERIC(14,2):=0;
  v_assets_current NUMERIC(14,2):=0; v_assets_fixed NUMERIC(14,2):=0; v_assets_total NUMERIC(14,2):=0;
  v_liab_ap NUMERIC(14,2):=0; v_liab_tax NUMERIC(14,2):=0; v_liab_loyalty NUMERIC(14,2):=0; v_liab_other NUMERIC(14,2):=0;
  v_liab_current NUMERIC(14,2):=0; v_liab_long NUMERIC(14,2):=0; v_liab_total NUMERIC(14,2):=0;
  v_eq_capital NUMERIC(14,2):=0; v_eq_retained NUMERIC(14,2):=0; v_eq_other NUMERIC(14,2):=0; v_eq_total NUMERIC(14,2):=0;
  v_cye_revenue NUMERIC(14,2):=0; v_cye_cogs NUMERIC(14,2):=0; v_cye_opex NUMERIC(14,2):=0; v_cye NUMERIC(14,2):=0;
  v_ytd_start DATE; v_delta NUMERIC(14,2):=0; v_balanced BOOLEAN:=FALSE; v_lines JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_stock_owner_v1();
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'get_balance_sheet_v3: p_as_of_date is required';
  END IF;
  v_ytd_start := date_trunc('year', p_as_of_date::TIMESTAMP)::DATE;
  WITH agg AS (
    SELECT a.id AS account_id, a.code, a.name, a.account_class, a.balance_type,
      SUM(COALESCE(jel.debit, 0))::NUMERIC(14,2) AS d, SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS c
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.status IN ('posted','locked') AND je.entry_date <= p_as_of_date AND a.account_class IN (1, 2, 3)
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '111%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '113%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '114%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '115%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2141') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2110','2142','2143') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code = '2210' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code NOT IN ('2141','2110','2142','2143','2210') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code = '3100' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code LIKE '32%' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code NOT IN ('3100','3300') AND code NOT LIKE '32%' THEN (c - d) END), 0),
    COALESCE(jsonb_agg(jsonb_build_object('account_id', account_id, 'code', code, 'name', name, 'debit', d, 'credit', c,
      'balance', CASE WHEN balance_type = 'debit' THEN (d - c) ELSE (c - d) END, 'account_class', account_class)
      ORDER BY code) FILTER (WHERE d <> 0 OR c <> 0), '[]'::JSONB)
  INTO v_assets_cash, v_assets_ar, v_assets_inv, v_assets_other, v_liab_ap, v_liab_tax, v_liab_loyalty, v_liab_other,
    v_eq_capital, v_eq_retained, v_eq_other, v_lines
  FROM agg;
  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0)
  INTO v_cye_revenue, v_cye_cogs, v_cye_opex
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked') AND je.entry_date BETWEEN v_ytd_start AND p_as_of_date
    AND a.account_class IN (4, 5, 6)
    AND NOT (je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));
  v_cye := (v_cye_revenue - v_cye_cogs - v_cye_opex)::NUMERIC(14,2);
  v_assets_current := (v_assets_cash + v_assets_ar + v_assets_inv + v_assets_other)::NUMERIC(14,2);
  v_assets_total := (v_assets_current + v_assets_fixed)::NUMERIC(14,2);
  v_liab_current := (v_liab_ap + v_liab_tax + v_liab_loyalty + v_liab_other)::NUMERIC(14,2);
  v_liab_total := (v_liab_current + v_liab_long)::NUMERIC(14,2);
  v_eq_total := (v_eq_capital + v_eq_retained + v_eq_other + v_cye)::NUMERIC(14,2);
  v_delta := (v_assets_total - (v_liab_total + v_eq_total))::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;
  RETURN jsonb_build_object(
    'assets', jsonb_build_object('current', jsonb_build_object('cash', v_assets_cash, 'ar', v_assets_ar,
      'inventory', v_assets_inv, 'other', v_assets_other, 'total', v_assets_current),
      'fixed', jsonb_build_object('total', v_assets_fixed), 'total', v_assets_total),
    'liabilities', jsonb_build_object('current', jsonb_build_object('ap', v_liab_ap, 'tax_payable', v_liab_tax,
      'loyalty', v_liab_loyalty, 'other', v_liab_other, 'total', v_liab_current),
      'long_term', jsonb_build_object('total', v_liab_long), 'total', v_liab_total),
    'equity', jsonb_build_object('share_capital', v_eq_capital, 'retained_earnings', v_eq_retained,
      'current_year_earnings', v_cye, 'other', v_eq_other, 'total', v_eq_total),
    'balanced', v_balanced, 'delta', v_delta, 'as_of', p_as_of_date, 'lines', v_lines);
END; $function$
;
REVOKE ALL ON FUNCTION public.get_balance_sheet_v4(p_as_of_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_balance_sheet_v4(p_as_of_date date) TO authenticated,service_role;
DROP FUNCTION public.get_balance_sheet_v3(p_as_of_date date);

CREATE OR REPLACE FUNCTION public.get_general_ledger_v4(p_account_id uuid, p_date_start date, p_date_end date, p_limit integer DEFAULT 50, p_cursor jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines           JSONB;
  v_account         RECORD;
  v_opening_balance NUMERIC(14,2) := 0;
  v_total_debit     NUMERIC(14,2) := 0;
  v_total_credit    NUMERIC(14,2) := 0;
  v_next_cursor     JSONB := NULL;
  v_cursor_date     DATE;
  v_cursor_id       UUID;
  v_count           INT;
BEGIN
  IF NOT public.is_business_owner_v1() AND EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND code LIKE '114%') THEN RAISE EXCEPTION 'stock_visibility_owner_required' USING ERRCODE='P0003'; END IF;
  IF NOT has_permission(auth.uid(), 'accounting.gl.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.gl.read' USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, code, name, account_class, balance_type, is_active
    INTO v_account FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(SUM(
      CASE v_account.balance_type
        WHEN 'debit'  THEN (jel.debit - jel.credit)
        ELSE              (jel.credit - jel.debit)
      END), 0)
  INTO v_opening_balance
  FROM reporting_private.safe_detail_journal_lines_v1 jel
  JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
    AND je.entry_date < p_date_start
    AND NOT (je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));
  IF p_cursor IS NOT NULL THEN
    v_cursor_date := (p_cursor->>'last_date')::DATE;
    v_cursor_id   := (p_cursor->>'last_id')::UUID;
  END IF;
  WITH paged AS (
    SELECT je.id AS je_id, je.entry_number, je.entry_date, je.description AS je_description,
      je.reference_type, je.reference_id, jel.debit, jel.credit, jel.description AS line_description
    FROM reporting_private.safe_detail_journal_lines_v1 jel
    JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
      AND (v_cursor_date IS NULL OR (je.entry_date, je.id) > (v_cursor_date, v_cursor_id))
    ORDER BY je.entry_date ASC, je.id ASC LIMIT p_limit + 1
  )
  SELECT COALESCE(jsonb_agg(
      jsonb_build_object('je_id', je_id, 'entry_number', entry_number, 'entry_date', entry_date,
        'description', je_description, 'reference_type', reference_type, 'reference_id', reference_id,
        'debit', debit, 'credit', credit, 'line_description', line_description)
      ORDER BY entry_date ASC, je_id ASC) FILTER (WHERE TRUE), '[]'::JSONB), COUNT(*)::INT
  INTO v_lines, v_count
  FROM (SELECT * FROM paged LIMIT p_limit) windowed;
  IF v_count >= p_limit AND EXISTS (
    SELECT 1 FROM reporting_private.safe_detail_journal_lines_v1 jel
    JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
      AND (v_cursor_date IS NULL OR (je.entry_date, je.id) > (v_cursor_date, v_cursor_id))
    OFFSET p_limit LIMIT 1
  ) THEN
    SELECT jsonb_build_object('last_date', entry_date, 'last_id', je_id)
      INTO v_next_cursor
      FROM jsonb_to_recordset(v_lines) AS x(je_id UUID, entry_date DATE)
      ORDER BY entry_date DESC, je_id DESC LIMIT 1;
  END IF;
  SELECT COALESCE(SUM(jel.debit), 0), COALESCE(SUM(jel.credit), 0)
  INTO v_total_debit, v_total_credit
  FROM reporting_private.safe_detail_journal_lines_v1 jel
  JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND NOT (je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));
  RETURN jsonb_build_object(
    'account', jsonb_build_object('id', v_account.id, 'code', v_account.code, 'name', v_account.name,
      'account_class', v_account.account_class, 'balance_type', v_account.balance_type, 'is_active', v_account.is_active),
    'period', jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'opening_balance', v_opening_balance, 'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'lines', v_lines, 'next_cursor', v_next_cursor);
END; $function$
;
REVOKE ALL ON FUNCTION public.get_general_ledger_v4(p_account_id uuid, p_date_start date, p_date_end date, p_limit integer, p_cursor jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_general_ledger_v4(p_account_id uuid, p_date_start date, p_date_end date, p_limit integer, p_cursor jsonb) TO authenticated,service_role;
DROP FUNCTION public.get_general_ledger_v3(p_account_id uuid, p_date_start date, p_date_end date, p_limit integer, p_cursor jsonb);

CREATE OR REPLACE FUNCTION public.get_pb1_report_v5(p_period_month integer, p_period_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_start_date     DATE;
  v_end_date       DATE;
  v_pb1_rate       NUMERIC;
  v_taxable_base   NUMERIC(15,2);
  v_pb1_collected  NUMERIC(15,2);
  v_pb1_payable    NUMERIC(15,2);
  v_pb1_account_id UUID;
  v_balance        NUMERIC(15,2);
  v_by_day         JSONB;
  v_calc           JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;
  IF p_period_month < 1 OR p_period_month > 12 THEN
    RAISE EXCEPTION 'Invalid month: %', p_period_month USING ERRCODE = '22023';
  END IF;
  IF p_period_year < 2000 OR p_period_year > 2100 THEN
    RAISE EXCEPTION 'Invalid year: %', p_period_year USING ERRCODE = '22023';
  END IF;

  v_start_date := make_date(p_period_year, p_period_month, 1);
  v_end_date   := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::date;

  v_pb1_rate := current_pb1_rate();

  -- Taxable base = subtotal (excl. tax), pb1_collected = tax_amount from reporting_private.closed_pos_orders_v1
  SELECT
    COALESCE(SUM(subtotal),    0),
    COALESCE(SUM(tax_amount),  0)
  INTO v_taxable_base, v_pb1_collected
  FROM reporting_private.recognized_sales_v2
  WHERE recognized_at::date BETWEEN v_start_date AND v_end_date
    AND status NOT IN ('voided');

  -- Reuse calculate_pb1_payable helper — signature: (p_period_start DATE, p_period_end DATE)
  -- DEV-S30-1.B-01: actual signature uses DATE args, not TEXT as originally assumed
  -- Lot D1 : bump _v1→_v2 — calculate_pb1_payable a gagné le gate reports.financial.read,
  -- règle RPC versioning monotone oblige (jamais éditer une _vN publiée).
  v_calc := calculate_pb1_payable_v4(v_start_date, v_end_date);
  v_pb1_payable := COALESCE((v_calc->>'pb1_payable')::numeric, v_pb1_collected);

  -- Balance on account 2110 (PB1 Payable) at period end
  SELECT id INTO v_pb1_account_id FROM accounts WHERE code = '2110' LIMIT 1;
  IF v_pb1_account_id IS NOT NULL THEN
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
    INTO v_balance
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_account_id
      AND je.entry_date <= v_end_date;
  ELSE
    v_balance := 0;
  END IF;

  -- Daily breakdown
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      recognized_at::date                AS day,
      COALESCE(SUM(subtotal),   0)   AS taxable_base,
      COALESCE(SUM(tax_amount), 0)   AS pb1_collected
    FROM reporting_private.recognized_sales_v2
    WHERE recognized_at::date BETWEEN v_start_date AND v_end_date
      AND status NOT IN ('voided')
    GROUP BY recognized_at::date
  ) t;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'month', p_period_month,
      'year',  p_period_year,
      'start', v_start_date::text,
      'end',   v_end_date::text
    ),
    'pb1_rate',              v_pb1_rate,
    'taxable_base',          v_taxable_base,
    'pb1_collected',         v_pb1_collected,
    'pb1_payable',           v_pb1_payable,
    'by_day',                v_by_day,
    'balance_account_code',  '2110',
    'balance_at_period_end', v_balance
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pb1_report_v5(p_period_month integer, p_period_year integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pb1_report_v5(p_period_month integer, p_period_year integer) TO authenticated,service_role;
DROP FUNCTION public.get_pb1_report_v3(p_period_month integer, p_period_year integer);
DROP FUNCTION public.get_pb1_report_v4(p_period_month integer, p_period_year integer);

CREATE OR REPLACE FUNCTION public.get_cashier_variance_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz       TEXT;
  v_cashiers JSONB;
  v_totals   JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

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
    FROM reporting_private.closed_pos_sessions_v1 ps
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

  WITH sessions AS (
    SELECT ps.variance_total AS cash_var, ps.counted_qris, ps.counted_card,
           CASE WHEN ps.counted_qris IS NOT NULL THEN (sc.metadata->>'variance_qris')::numeric END AS qris_var,
           CASE WHEN ps.counted_card IS NOT NULL THEN (sc.metadata->>'variance_card')::numeric END AS card_var
      FROM reporting_private.closed_pos_sessions_v1 ps
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
$function$
;
REVOKE ALL ON FUNCTION public.get_cashier_variance_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_cashier_variance_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_cashier_variance_v2(p_start_date date, p_end_date date);
