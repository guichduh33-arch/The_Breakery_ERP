-- 20260706000021 — Cash Wallets : analysis RPC (Excel "Private Analysis" replica).
CREATE OR REPLACE FUNCTION get_cash_wallet_analysis_v1(p_date_start DATE, p_date_end DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_revenue_by_shift JSONB;
  v_top_petty        JSONB;
  v_deposits         NUMERIC;
  v_boss             NUMERIC;
BEGIN
  -- Revenue per shift = cash-sale debits on 1110 grouped per session, ranked per day.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_revenue_by_shift FROM (
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (PARTITION BY je.entry_date ORDER BY MIN(s.opened_at))::text AS shift,
           SUM(jel.debit) AS total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status='posted'
    JOIN accounts a ON a.id = jel.account_id AND a.code='1110'
    JOIN orders o ON je.reference_type='sale' AND je.reference_id=o.id
    LEFT JOIN pos_sessions s ON s.id=o.session_id
    WHERE je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id
    ORDER BY je.entry_date
  ) t;

  -- Top Petty Cash spend categories = expense JE crediting 1111, grouped by category account.
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_petty FROM (
    SELECT cat.name AS category, SUM(line.debit) AS total, count(*) AS occurrences
    FROM journal_entries je
    JOIN journal_entry_lines credit ON credit.journal_entry_id=je.id
      JOIN accounts ca ON ca.id=credit.account_id AND ca.code='1111' AND credit.credit > 0
    JOIN journal_entry_lines line ON line.journal_entry_id=je.id AND line.debit > 0
    JOIN accounts cat ON cat.id=line.account_id
    WHERE je.reference_type='expense' AND je.status='posted'
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY cat.name
    ORDER BY SUM(line.debit) DESC
    LIMIT 10
  ) t;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_deposits
  FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='1112'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  SELECT COALESCE(SUM(jel.debit),0) INTO v_boss
  FROM journal_entries je JOIN journal_entry_lines jel ON jel.journal_entry_id=je.id
  JOIN accounts a ON a.id=jel.account_id AND a.code='3110'
  WHERE je.reference_type='cash_movement' AND je.status='posted'
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  RETURN jsonb_build_object(
    'revenue_by_shift', v_revenue_by_shift,
    'top_petty_categories', v_top_petty,
    'deposits_total', v_deposits,
    'boss_withdrawals_total', v_boss
  );
END $$;
COMMENT ON FUNCTION get_cash_wallet_analysis_v1(DATE,DATE) IS 'Cash Wallets : Private-Analysis replica (revenue/shift, top petty categories, deposits, boss withdrawals).';
REVOKE EXECUTE ON FUNCTION get_cash_wallet_analysis_v1(DATE,DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_cash_wallet_analysis_v1(DATE,DATE) TO authenticated;

-- Project anon defense-in-depth (S20): ensure future public functions default-revoked from PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
