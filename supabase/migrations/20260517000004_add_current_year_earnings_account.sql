-- 20260517000004_add_current_year_earnings_account.sql
-- Session 13 / Phase 1.A / migration 10-008 :
--   Add account 3300 Current Year Earnings (equity, is_postable=false — system slot)
--   + create RPC get_balance_sheet_data() (build-from-scratch) that calculates CYE
--   on the fly from Revenue – (COGS + Expense) for the open period.
--
-- Why : SAK EMKM requires equity to roll up current period P&L into a single equity
-- slot. Otherwise the balance sheet cannot balance (debits ≠ credits) outside a
-- close-period workflow.
--
-- Decision : D13 / Module 10-008 acceptance criterion.

INSERT INTO accounts (code, name, account_class, account_type, balance_type, is_postable, is_system, is_active)
VALUES
  ('3300', 'Current Year Earnings', 3, 'equity', 'credit', false, true, true)
ON CONFLICT (code) DO NOTHING;

-- RPC : get_balance_sheet_data(p_as_of DATE DEFAULT CURRENT_DATE)
--
-- Returns a JSONB shape suitable for the /backoffice/accounting/balance-sheet page :
-- { as_of, asset_lines, liability_lines, equity_lines, current_year_earnings, totals }
--
-- Equity 3300 is computed live as Σ(revenue credits) - Σ(cogs + expense debits)
-- for entries dated within the calendar year containing p_as_of and up to p_as_of.
CREATE OR REPLACE FUNCTION get_balance_sheet_data(p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_year_start  DATE := date_trunc('year', p_as_of)::DATE;
  v_asset       JSONB;
  v_liability   JSONB;
  v_equity      JSONB;
  v_cye         DECIMAL(14,2);
  v_total_a     DECIMAL(14,2);
  v_total_l     DECIMAL(14,2);
  v_total_e     DECIMAL(14,2);
BEGIN
  -- Aggregate by account: net debit-credit (asset/expense) or credit-debit (liability/equity/revenue).
  WITH balances AS (
    SELECT
      a.id,
      a.code,
      a.name,
      a.account_class,
      a.account_type,
      a.balance_type,
      COALESCE(SUM(jel.debit),  0) AS total_debit,
      COALESCE(SUM(jel.credit), 0) AS total_credit
    FROM accounts a
    LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
    LEFT JOIN journal_entries je      ON je.id = jel.journal_entry_id
      AND je.entry_date <= p_as_of
      AND je.status = 'posted'
    WHERE a.is_active = true
      AND a.deleted_at IS NULL
    GROUP BY a.id, a.code, a.name, a.account_class, a.account_type, a.balance_type
  )
  SELECT
    -- Asset lines (debit balance positive)
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'balance', (total_debit - total_credit)
      ) ORDER BY code)
      FROM balances WHERE account_class = 1 AND (total_debit - total_credit) <> 0), '[]'::jsonb),
    -- Liability lines (credit balance positive)
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'balance', (total_credit - total_debit)
      ) ORDER BY code)
      FROM balances WHERE account_class = 2 AND (total_credit - total_debit) <> 0), '[]'::jsonb),
    -- Equity lines (credit balance positive ; EXCLUDE 3300 — calculated live)
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'balance', (total_credit - total_debit)
      ) ORDER BY code)
      FROM balances WHERE account_class = 3 AND code <> '3300' AND (total_credit - total_debit) <> 0), '[]'::jsonb)
  INTO v_asset, v_liability, v_equity;

  -- CYE = Σ revenue credits - Σ (cogs + expense) debits for current year up to p_as_of.
  SELECT COALESCE(SUM(
           CASE
             WHEN a.account_class = 4 THEN  jel.credit - jel.debit  -- revenue
             WHEN a.account_class = 5 THEN -(jel.debit  - jel.credit) -- cogs
             WHEN a.account_class = 6 THEN -(jel.debit  - jel.credit) -- expense
             ELSE 0
           END
         ), 0)
    INTO v_cye
    FROM journal_entry_lines jel
    JOIN journal_entries     je ON je.id = jel.journal_entry_id
    JOIN accounts            a  ON a.id  = jel.account_id
    WHERE je.entry_date BETWEEN v_year_start AND p_as_of
      AND je.status = 'posted'
      AND a.account_class IN (4, 5, 6);

  -- Totals
  SELECT COALESCE(SUM((x->>'balance')::DECIMAL(14,2)), 0)
    INTO v_total_a FROM jsonb_array_elements(v_asset) AS x;
  SELECT COALESCE(SUM((x->>'balance')::DECIMAL(14,2)), 0)
    INTO v_total_l FROM jsonb_array_elements(v_liability) AS x;
  SELECT COALESCE(SUM((x->>'balance')::DECIMAL(14,2)), 0)
    INTO v_total_e FROM jsonb_array_elements(v_equity) AS x;

  v_total_e := v_total_e + v_cye;

  RETURN jsonb_build_object(
    'as_of',                  p_as_of,
    'year_start',             v_year_start,
    'asset_lines',            v_asset,
    'liability_lines',        v_liability,
    'equity_lines',           v_equity,
    'current_year_earnings',  v_cye,
    'totals', jsonb_build_object(
      'assets',       v_total_a,
      'liabilities',  v_total_l,
      'equity',       v_total_e,
      'balances',     (v_total_a = v_total_l + v_total_e)
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION get_balance_sheet_data(DATE) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_balance_sheet_data(DATE) TO authenticated;

COMMENT ON FUNCTION get_balance_sheet_data(DATE) IS
  'D13 / 10-008. SAK-EMKM balance sheet snapshot at p_as_of. Computes Current '
  'Year Earnings (account 3300) live from Σ Revenue - Σ (COGS+Expense) over the '
  'calendar year ; never written to journal_entries.';
