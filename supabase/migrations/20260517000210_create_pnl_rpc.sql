-- 20260517000210_create_pnl_rpc.sql
-- Session 13 / Phase 6.A — Profit & Loss report RPC.
--
-- RPC `get_profit_loss_v1(p_date_start, p_date_end, p_section_id := NULL)`
-- aggregates posted/locked journal entry lines into a P&L JSON structure:
--
--   {
--     "revenue":          { "sales": N, "discounts": -N, "adjustments": N, "total": N },
--     "cogs":             { "production": N, "waste": N, "other": N, "total": N },
--     "gross_profit":     N,
--     "opex":             { "salary": N, "rent": N, "utilities": N, ..., "total": N },
--     "operating_profit": N,
--     "net_profit":       N,
--     "lines":            [ { code, name, debit, credit, balance, account_class } ],
--     "period":           { "start": "...", "end": "..." }
--   }
--
-- `p_section_id` is currently a no-op (V3 JE lines don't carry a section ref).
-- The parameter is reserved for the future per-section P&L drill-down once
-- section-aware tagging lands. Always live-queries `journal_entry_lines`
-- (deviation D-W6-6A-1) — does NOT consume `mv_pl_monthly`.
--
-- CoA classes (verified live 2026-05-14 against `ikcyvlovptebroadgtvd`):
--   1xxx Asset, 2xxx Liability, 3xxx Equity, 4xxx Revenue,
--   5xxx COGS, 6xxx OpEx.
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-6.A-reports-cascade.md

CREATE OR REPLACE FUNCTION public.get_profit_loss_v1(
  p_date_start  DATE,
  p_date_end    DATE,
  p_section_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_revenue        NUMERIC(14,2) := 0;
  v_revenue_sales  NUMERIC(14,2) := 0;
  v_revenue_disc   NUMERIC(14,2) := 0;
  v_revenue_adj    NUMERIC(14,2) := 0;
  v_cogs           NUMERIC(14,2) := 0;
  v_cogs_prod      NUMERIC(14,2) := 0;
  v_cogs_waste     NUMERIC(14,2) := 0;
  v_cogs_other     NUMERIC(14,2) := 0;
  v_opex           NUMERIC(14,2) := 0;
  v_opex_salary    NUMERIC(14,2) := 0;
  v_opex_rent      NUMERIC(14,2) := 0;
  v_opex_util      NUMERIC(14,2) := 0;
  v_opex_supplies  NUMERIC(14,2) := 0;
  v_opex_marketing NUMERIC(14,2) := 0;
  v_opex_maint     NUMERIC(14,2) := 0;
  v_opex_other     NUMERIC(14,2) := 0;
  v_lines          JSONB         := '[]'::JSONB;
BEGIN
  -- Defensive bounds.
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_profit_loss_v1: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_profit_loss_v1: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  -- ----------------------------------------------------------------
  -- Aggregate JE lines by account, restricted to posted/locked entries
  -- in [p_date_start, p_date_end]. For revenue (class 4), the natural
  -- normal balance is credit so revenue = credit - debit. For COGS/OpEx
  -- (class 5/6) the natural normal is debit so expense = debit - credit.
  -- ----------------------------------------------------------------
  WITH agg AS (
    SELECT
      a.id            AS account_id,
      a.code          AS code,
      a.name          AS name,
      a.account_class AS account_class,
      a.balance_type  AS balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS total_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je
      ON je.id = jel.journal_entry_id
    JOIN accounts a
      ON a.id = jel.account_id
    WHERE je.status IN ('posted', 'locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND a.account_class IN (4, 5, 6)
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    -- Revenue subtotals (class 4)
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '41%'  THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code IN ('4190','4900') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '45%'  THEN (total_credit - total_debit) END), 0)
      + COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '49%' AND code NOT IN ('4900','4190') THEN (total_credit - total_debit) END), 0),
    -- Revenue total = sum of all class-4 net credits (handles discounts as debit-balance accounts)
    COALESCE(SUM(CASE WHEN account_class = 4 THEN (total_credit - total_debit) END), 0),
    -- COGS subtotals (class 5)
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '51%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code NOT LIKE '51%' AND code NOT LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 THEN (total_debit - total_credit) END), 0),
    -- OpEx subtotals (class 6)
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6111' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6112' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6113' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6114' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6115' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6116' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code NOT IN ('6111','6112','6113','6114','6115','6116') THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 THEN (total_debit - total_credit) END), 0),
    -- Per-account line array (sorted by code, only accounts with activity)
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'code',          code,
          'name',          name,
          'debit',         total_debit,
          'credit',        total_credit,
          'balance',
            CASE
              WHEN balance_type = 'debit'  THEN (total_debit  - total_credit)
              ELSE                              (total_credit - total_debit)
            END,
          'account_class', account_class
        )
        ORDER BY code
      ) FILTER (WHERE total_debit <> 0 OR total_credit <> 0),
      '[]'::JSONB
    )
  INTO
    v_revenue_sales, v_revenue_disc, v_revenue_adj, v_revenue,
    v_cogs_prod, v_cogs_waste, v_cogs_other, v_cogs,
    v_opex_salary, v_opex_rent, v_opex_util, v_opex_supplies,
    v_opex_marketing, v_opex_maint, v_opex_other, v_opex,
    v_lines
  FROM agg;

  RETURN jsonb_build_object(
    'revenue', jsonb_build_object(
      'sales',       v_revenue_sales,
      'discounts',   v_revenue_disc,
      'adjustments', v_revenue_adj,
      'total',       v_revenue
    ),
    'cogs', jsonb_build_object(
      'production', v_cogs_prod,
      'waste',      v_cogs_waste,
      'other',      v_cogs_other,
      'total',      v_cogs
    ),
    'gross_profit', (v_revenue - v_cogs)::NUMERIC(14,2),
    'opex', jsonb_build_object(
      'salary',     v_opex_salary,
      'rent',       v_opex_rent,
      'utilities',  v_opex_util,
      'supplies',   v_opex_supplies,
      'marketing',  v_opex_marketing,
      'maintenance',v_opex_maint,
      'other',      v_opex_other,
      'total',      v_opex
    ),
    'operating_profit', (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'net_profit',       (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'lines',  v_lines,
    'period', jsonb_build_object(
      'start',      p_date_start,
      'end',        p_date_end,
      'section_id', p_section_id
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_profit_loss_v1(DATE, DATE, UUID) IS
  'Phase 6.A — Profit & Loss report. Aggregates posted/locked JE lines '
  'by account_class (4=revenue, 5=COGS, 6=OpEx) within [start, end]. '
  'Returns nested JSONB with subtotals, gross profit, net profit and '
  'per-account drill-down lines.';

GRANT EXECUTE ON FUNCTION public.get_profit_loss_v1(DATE, DATE, UUID) TO authenticated;
