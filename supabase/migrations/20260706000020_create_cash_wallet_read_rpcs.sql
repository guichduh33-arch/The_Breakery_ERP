-- 20260706000020 — Cash Wallets : read RPCs (balances + ledger with shift aggregation).

-- (a) Balances : GL net (debit-positive) per wallet.
CREATE OR REPLACE FUNCTION get_cash_wallet_balances_v1()
RETURNS TABLE(account_code TEXT, account_name TEXT, balance NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.code, a.name,
         COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE a.code IN ('1110','1111','1117')
  GROUP BY a.code, a.name
  ORDER BY a.code;
$$;
COMMENT ON FUNCTION get_cash_wallet_balances_v1() IS 'Cash Wallets : live GL net balance for 1110/1111/1117.';
REVOKE EXECUTE ON FUNCTION get_cash_wallet_balances_v1() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_cash_wallet_balances_v1() TO authenticated;

-- (b) Ledger : opening carry-forward + movement rows. Undeposited aggregates cash sales per shift.
CREATE OR REPLACE FUNCTION get_cash_wallet_ledger_v1(
  p_account_code TEXT,
  p_date_start   DATE,
  p_date_end     DATE
) RETURNS TABLE(row_date DATE, remark TEXT, in_amount NUMERIC, out_amount NUMERIC, saldo NUMERIC, ref_type TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_acc_id  UUID;
  v_opening NUMERIC;
BEGIN
  SELECT id INTO v_acc_id FROM accounts WHERE code = p_account_code;
  IF v_acc_id IS NULL THEN
    RAISE EXCEPTION 'unknown account code %', p_account_code USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE jel.account_id = v_acc_id AND je.entry_date < p_date_start;

  RETURN QUERY
  WITH raw AS (
    -- Undeposited cash sales → aggregate per session as one "Shift N" row.
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (
              PARTITION BY je.entry_date ORDER BY MIN(s.opened_at)
           )::text AS rmk,
           SUM(jel.debit) AS in_amt, SUM(jel.credit) AS out_amt,
           'sale'::text AS rt, 1 AS grp
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    JOIN orders o          ON je.reference_type = 'sale' AND je.reference_id = o.id
    LEFT JOIN pos_sessions s ON s.id = o.session_id
    WHERE p_account_code = '1110'
      AND jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id

    UNION ALL

    -- All non-sale lines (and ALL lines for non-Undeposited wallets) pass through 1:1.
    SELECT je.entry_date AS d,
           COALESCE(jel.description, je.description) AS rmk,
           jel.debit AS in_amt, jel.credit AS out_amt,
           je.reference_type AS rt, 0 AS grp
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    WHERE jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (p_account_code = '1110' AND je.reference_type = 'sale')
  ),
  ordered AS (
    SELECT d, rmk, in_amt, out_amt, rt,
           row_number() OVER (ORDER BY d, grp DESC, rmk) AS rn
    FROM raw
  )
  SELECT o.d, o.rmk, o.in_amt, o.out_amt,
         v_opening + SUM(o.in_amt - o.out_amt) OVER (ORDER BY o.rn
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo,
         o.rt
  FROM ordered o
  ORDER BY o.rn;
END $$;
COMMENT ON FUNCTION get_cash_wallet_ledger_v1(TEXT,DATE,DATE) IS
  'Cash Wallets : In/Out/Saldo ledger for one wallet, opening carry-forward, Undeposited sales aggregated per shift.';
REVOKE EXECUTE ON FUNCTION get_cash_wallet_ledger_v1(TEXT,DATE,DATE) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_cash_wallet_ledger_v1(TEXT,DATE,DATE) TO authenticated;

-- Project anon defense-in-depth (S20): ensure future public functions default-revoked from PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
