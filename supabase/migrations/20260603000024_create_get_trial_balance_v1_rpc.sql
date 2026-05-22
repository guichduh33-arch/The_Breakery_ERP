-- 20260603000024_create_get_trial_balance_v1_rpc.sql
-- Session 26 / Wave 1.I / migration _024 :
--   get_trial_balance_v1(p_start, p_end) RETURNS JSONB
--
-- Trial Balance : tous les comptes actifs avec sum_debit / sum_credit /
-- balance computed selon balance_type. Assert that Σ debit = Σ credit.
--
-- Gate : SECURITY INVOKER (RLS controlled). Permission accounting.tb.read
-- (seedée _026) ou reports.financial.read.

CREATE OR REPLACE FUNCTION public.get_trial_balance_v1(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_lines       JSONB;
  v_total_debit  NUMERIC(14,2);
  v_total_credit NUMERIC(14,2);
  v_balanced    BOOLEAN;
  v_delta       NUMERIC(14,2);
BEGIN
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  WITH agg AS (
    SELECT
      a.id,
      a.code,
      a.name,
      a.account_class,
      a.balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS total_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries     je  ON je.id = jel.journal_entry_id
      AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
    WHERE a.is_active = TRUE
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id',    id,
        'code',          code,
        'name',          name,
        'account_class', account_class,
        'balance_type',  balance_type,
        'total_debit',   total_debit,
        'total_credit',  total_credit,
        'balance',
          CASE balance_type
            WHEN 'debit'  THEN (total_debit  - total_credit)
            ELSE              (total_credit - total_debit)
          END
      )
      ORDER BY code
    ) FILTER (WHERE total_debit <> 0 OR total_credit <> 0), '[]'::JSONB),
    COALESCE(SUM(total_debit),  0),
    COALESCE(SUM(total_credit), 0)
  INTO v_lines, v_total_debit, v_total_credit
  FROM agg;

  v_delta := (v_total_debit - v_total_credit)::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'lines', v_lines,
    'total_debit',  v_total_debit,
    'total_credit', v_total_credit,
    'balanced',     v_balanced,
    'delta',        v_delta
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_trial_balance_v1(DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_trial_balance_v1(DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_trial_balance_v1(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.get_trial_balance_v1(DATE, DATE) IS
  'S26 cockpit : Trial Balance — tous les comptes actifs avec sum DR/CR sur la '
  'période. Asserts Σ debit = Σ credit (balanced flag). Dedupe sale_void+refund.';
