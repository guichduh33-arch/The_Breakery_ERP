-- 20260617000011_bump_get_balance_sheet_v1_expose_account_id.sql
-- Session 32 / Wave 1.C / migration _011 :
--   Additive bump: expose `account_id` (UUID) in a new `lines` JSONB array
--   returned by get_balance_sheet_v1.
--
-- Motivation :
--   BO drill-down links (DrilldownLink / buildDrilldownUrl, S31) navigate to the
--   General Ledger by UUID.  The existing CTE `agg` grouped by a.code but did
--   not SELECT a.id.  This bump adds a.id AS account_id to the CTE and emits a
--   `lines` array (one row per account) in the JSONB output, enabling the BO to
--   build drill-down URLs like /accounting/general-ledger?account_id=<uuid>.
--
-- Structural note :
--   Unlike get_profit_loss_v1 (which already had a jsonb_agg `lines` array),
--   get_balance_sheet_v1 aggregated into scalar NUMERIC variables — no per-account
--   lines were emitted.  This bump adds a second pass over the same CTE to build
--   the lines array while leaving all existing summary keys (assets/liabilities/
--   equity/balanced/delta/as_of) COMPLETELY UNCHANGED.
--
-- Change (ONLY) :
--   1. CTE `agg`: add `a.id AS account_id` to the SELECT.
--   2. New SELECT from agg → v_lines JSONB (jsonb_agg of per-account objects,
--      each containing 'account_id', 'code', 'name', 'balance', 'account_class').
--   3. RETURN jsonb_build_object: add 'lines', v_lines as an additional key.
--
-- All S26 _018 logic is PRESERVED intact :
--   - NOT EXISTS dedupe (sale_void + refund check) on the CTE agg WHERE clause.
--   - Both SELECT ... INTO blocks (class 1/2/3 agg and class 4/5/6 CYE calc).
--   - All scalar variable declarations and arithmetic.
--   - v_balanced / v_delta computation.
--
-- Signature is UNCHANGED (same input arg + RETURNS JSONB) → CREATE OR REPLACE,
-- no v2 bump required.

CREATE OR REPLACE FUNCTION public.get_balance_sheet_v1(
  p_as_of_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
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
  v_lines             JSONB         := '[]'::JSONB;
BEGIN
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'get_balance_sheet_v1: p_as_of_date is required';
  END IF;

  v_ytd_start := date_trunc('year', p_as_of_date::TIMESTAMP)::DATE;

  WITH agg AS (
    SELECT
      a.id            AS account_id,
      a.code,
      a.name,
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
      -- F-S26-AC-04 : dedupe sale_void si refund existe
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
      )
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
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'account_id',    account_id,
          'code',          code,
          'name',          name,
          'debit',         d,
          'credit',        c,
          'balance',
            CASE
              WHEN balance_type = 'debit'  THEN (d - c)
              ELSE                              (c - d)
            END,
          'account_class', account_class
        )
        ORDER BY code
      ) FILTER (WHERE d <> 0 OR c <> 0),
      '[]'::JSONB
    )
  INTO
    v_assets_cash, v_assets_ar, v_assets_inv, v_assets_other,
    v_liab_ap, v_liab_tax, v_liab_loyalty, v_liab_other,
    v_eq_capital, v_eq_retained, v_eq_other,
    v_lines
  FROM agg;

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
    AND a.account_class IN (4, 5, 6)
    -- F-S26-AC-04 : dedupe sale_void si refund existe (cohérent avec P&L)
    AND NOT (
      je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id)
    );

  v_cye := (v_cye_revenue - v_cye_cogs - v_cye_opex)::NUMERIC(14,2);

  v_assets_current := (v_assets_cash + v_assets_ar + v_assets_inv + v_assets_other)::NUMERIC(14,2);
  v_assets_total   := (v_assets_current + v_assets_fixed)::NUMERIC(14,2);
  v_liab_current   := (v_liab_ap + v_liab_tax + v_liab_loyalty + v_liab_other)::NUMERIC(14,2);
  v_liab_total     := (v_liab_current + v_liab_long)::NUMERIC(14,2);
  v_eq_total       := (v_eq_capital + v_eq_retained + v_eq_other + v_cye)::NUMERIC(14,2);
  v_delta          := (v_assets_total - (v_liab_total + v_eq_total))::NUMERIC(14,2);
  v_balanced       := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'assets', jsonb_build_object(
      'current', jsonb_build_object(
        'cash', v_assets_cash, 'ar', v_assets_ar, 'inventory', v_assets_inv,
        'other', v_assets_other, 'total', v_assets_current
      ),
      'fixed', jsonb_build_object('total', v_assets_fixed),
      'total', v_assets_total
    ),
    'liabilities', jsonb_build_object(
      'current', jsonb_build_object(
        'ap', v_liab_ap, 'tax_payable', v_liab_tax, 'loyalty', v_liab_loyalty,
        'other', v_liab_other, 'total', v_liab_current
      ),
      'long_term', jsonb_build_object('total', v_liab_long),
      'total', v_liab_total
    ),
    'equity', jsonb_build_object(
      'share_capital', v_eq_capital, 'retained_earnings', v_eq_retained,
      'current_year_earnings', v_cye, 'other', v_eq_other, 'total', v_eq_total
    ),
    'balanced', v_balanced,
    'delta',    v_delta,
    'as_of',    p_as_of_date,
    'lines',    v_lines
  );
END;
$$;

COMMENT ON FUNCTION public.get_balance_sheet_v1(DATE) IS
  'S32 wave 1.C additive: new `lines` array in output (one row per account, '
  'class 1/2/3) now includes `account_id` (UUID) as first key, enabling BO '
  'drill-down to General Ledger by UUID. All S26 _018 logic preserved '
  '(dedupe sale_void NOT EXISTS when refund exists for same order, '
  'F-S26-AC-04). Existing summary keys (assets/liabilities/equity/balanced/'
  'delta/as_of) are UNCHANGED.';
