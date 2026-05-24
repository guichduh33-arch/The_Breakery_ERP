CREATE OR REPLACE FUNCTION get_pb1_report_v1(p_period_month INT, p_period_year INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  -- Taxable base = subtotal (excl. tax), pb1_collected = tax_amount from orders
  SELECT
    COALESCE(SUM(subtotal),    0),
    COALESCE(SUM(tax_amount),  0)
  INTO v_taxable_base, v_pb1_collected
  FROM orders
  WHERE created_at::date BETWEEN v_start_date AND v_end_date
    AND status NOT IN ('voided');

  -- Reuse S26 helper — actual signature: (p_period_start DATE, p_period_end DATE)
  -- DEV-S30-1.B-01: calculate_pb1_payable_v1 takes DATE args not TEXT (adapted accordingly)
  v_calc := calculate_pb1_payable_v1(v_start_date, v_end_date);
  v_pb1_payable := COALESCE((v_calc->>'pb1_payable')::numeric, v_pb1_collected);

  -- Balance on account 2110 (PB1 Payable) at period end
  SELECT id INTO v_pb1_account_id FROM accounts WHERE code = '2110' LIMIT 1;
  IF v_pb1_account_id IS NOT NULL THEN
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
    INTO v_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
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
      created_at::date                AS day,
      COALESCE(SUM(subtotal),   0)   AS taxable_base,
      COALESCE(SUM(tax_amount), 0)   AS pb1_collected
    FROM orders
    WHERE created_at::date BETWEEN v_start_date AND v_end_date
      AND status NOT IN ('voided')
    GROUP BY created_at::date
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
$$;

COMMENT ON FUNCTION get_pb1_report_v1(INT, INT) IS
  'S30 : PB1 monthly report (NON-PKP). Uses current_pb1_rate() + calculate_pb1_payable_v1(p_period_start DATE, p_period_end DATE). Returns taxable_base, pb1_collected, pb1_payable, by_day, balance on account 2110. Excludes voided orders.';
