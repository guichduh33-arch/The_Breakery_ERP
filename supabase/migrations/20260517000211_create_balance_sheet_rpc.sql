-- 20260517000211_create_balance_sheet_rpc.sql
-- Session 13 / Phase 6.A — Balance Sheet report RPC.
--
-- RPC `get_balance_sheet_v1(p_as_of_date)` aggregates posted/locked JE
-- lines up to and including `p_as_of_date`, returns nested JSONB:
--
--   {
--     "assets": {
--       "current":  { "cash": N, "ar": N, "inventory": N, "other": N, "total": N },
--       "fixed":    { "total": N },
--       "total":    N
--     },
--     "liabilities": {
--       "current":   { "ap": N, "tax_payable": N, "loyalty": N, "other": N, "total": N },
--       "long_term": { "total": N },
--       "total":     N
--     },
--     "equity": {
--       "share_capital":       N,
--       "retained_earnings":   N,
--       "current_year_earnings": N,   -- COMPUTED LIVE from class-4/5/6 YTD
--       "total":               N
--     },
--     "balanced":    boolean,         -- |assets - (liab + equity)| < 0.01
--     "delta":       N,               -- assets - (liab + equity), 2 dp
--     "as_of":       "YYYY-MM-DD"
--   }
--
-- CYE (account code 3300, is_postable = false) is computed live by summing
-- net revenue (class 4) - COGS (class 5) - OpEx (class 6) from
-- `date_trunc('year', p_as_of_date)` through p_as_of_date. This matches
-- the closing-period accounting convention.
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-6.A-reports-cascade.md

CREATE OR REPLACE FUNCTION public.get_balance_sheet_v1(
  p_as_of_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_assets_cash       NUMERIC(14,2) := 0;
  v_assets_ar         NUMERIC(14,2) := 0;
  v_assets_inv        NUMERIC(14,2) := 0;
  v_assets_other      NUMERIC(14,2) := 0;
  v_assets_current    NUMERIC(14,2) := 0;
  v_assets_fixed      NUMERIC(14,2) := 0;
  v_assets_total      NUMERIC(14,2) := 0;

  v_liab_ap           NUMERIC(14,2) := 0;
  v_liab_tax          NUMERIC(14,2) := 0;
  v_liab_loyalty      NUMERIC(14,2) := 0;
  v_liab_other        NUMERIC(14,2) := 0;
  v_liab_current      NUMERIC(14,2) := 0;
  v_liab_long         NUMERIC(14,2) := 0;
  v_liab_total        NUMERIC(14,2) := 0;

  v_eq_capital        NUMERIC(14,2) := 0;
  v_eq_retained       NUMERIC(14,2) := 0;
  v_eq_other          NUMERIC(14,2) := 0;
  v_eq_total          NUMERIC(14,2) := 0;

  v_cye_revenue       NUMERIC(14,2) := 0;
  v_cye_cogs          NUMERIC(14,2) := 0;
  v_cye_opex          NUMERIC(14,2) := 0;
  v_cye               NUMERIC(14,2) := 0;

  v_ytd_start         DATE;
  v_delta             NUMERIC(14,2) := 0;
  v_balanced          BOOLEAN       := FALSE;
BEGIN
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'get_balance_sheet_v1: p_as_of_date is required';
  END IF;

  v_ytd_start := date_trunc('year', p_as_of_date::TIMESTAMP)::DATE;

  -- ----------------------------------------------------------------
  -- Asset / Liability / Equity balances as of p_as_of_date
  -- Asset (class 1, debit-normal) = debit - credit cumulative.
  -- Liability/Equity (class 2/3, credit-normal) = credit - debit cumulative.
  -- ----------------------------------------------------------------
  WITH agg AS (
    SELECT
      a.code,
      a.account_class,
      a.balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS d,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS c
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a         ON a.id = jel.account_id
    WHERE je.status IN ('posted','locked')
      AND je.entry_date <= p_as_of_date
      AND a.account_class IN (1, 2, 3)
    GROUP BY a.code, a.account_class, a.balance_type
  )
  SELECT
    -- Assets — class 1 (debit-normal)
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '111%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '113%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '114%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '115%' THEN (d - c) END), 0),
    -- Liabilities — class 2 (credit-normal)
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2141') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2110','2142','2143') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code = '2210' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code NOT IN ('2141','2110','2142','2143','2210') THEN (c - d) END), 0),
    -- Equity — class 3 (credit-normal)
    COALESCE(SUM(CASE WHEN account_class = 3 AND code = '3100' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code LIKE '32%' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code NOT IN ('3100','3300') AND code NOT LIKE '32%' THEN (c - d) END), 0)
  INTO
    v_assets_cash, v_assets_ar, v_assets_inv, v_assets_other,
    v_liab_ap, v_liab_tax, v_liab_loyalty, v_liab_other,
    v_eq_capital, v_eq_retained, v_eq_other
  FROM agg;

  -- ----------------------------------------------------------------
  -- CYE: compute live from YTD revenue/COGS/OpEx.
  -- ----------------------------------------------------------------
  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0)
  INTO v_cye_revenue, v_cye_cogs, v_cye_opex
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN v_ytd_start AND p_as_of_date
    AND a.account_class IN (4, 5, 6);

  v_cye := (v_cye_revenue - v_cye_cogs - v_cye_opex)::NUMERIC(14,2);

  -- Totals
  v_assets_current := (v_assets_cash + v_assets_ar + v_assets_inv + v_assets_other)::NUMERIC(14,2);
  v_assets_total   := (v_assets_current + v_assets_fixed)::NUMERIC(14,2);

  v_liab_current := (v_liab_ap + v_liab_tax + v_liab_loyalty + v_liab_other)::NUMERIC(14,2);
  v_liab_total   := (v_liab_current + v_liab_long)::NUMERIC(14,2);

  v_eq_total := (v_eq_capital + v_eq_retained + v_eq_other + v_cye)::NUMERIC(14,2);

  v_delta    := (v_assets_total - (v_liab_total + v_eq_total))::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'assets', jsonb_build_object(
      'current', jsonb_build_object(
        'cash',      v_assets_cash,
        'ar',        v_assets_ar,
        'inventory', v_assets_inv,
        'other',     v_assets_other,
        'total',     v_assets_current
      ),
      'fixed', jsonb_build_object(
        'total',     v_assets_fixed
      ),
      'total', v_assets_total
    ),
    'liabilities', jsonb_build_object(
      'current', jsonb_build_object(
        'ap',          v_liab_ap,
        'tax_payable', v_liab_tax,
        'loyalty',     v_liab_loyalty,
        'other',       v_liab_other,
        'total',       v_liab_current
      ),
      'long_term', jsonb_build_object(
        'total',       v_liab_long
      ),
      'total', v_liab_total
    ),
    'equity', jsonb_build_object(
      'share_capital',         v_eq_capital,
      'retained_earnings',     v_eq_retained,
      'current_year_earnings', v_cye,
      'other',                 v_eq_other,
      'total',                 v_eq_total
    ),
    'balanced', v_balanced,
    'delta',    v_delta,
    'as_of',    p_as_of_date
  );
END;
$$;

COMMENT ON FUNCTION public.get_balance_sheet_v1(DATE) IS
  'Phase 6.A — Balance Sheet report. Aggregates posted/locked JE lines '
  'cumulatively up to as-of date for classes 1/2/3. CYE computed live '
  'from class-4/5/6 YTD activity. balanced = |assets - (L+E)| < 0.01.';

GRANT EXECUTE ON FUNCTION public.get_balance_sheet_v1(DATE) TO authenticated;
