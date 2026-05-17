-- 20260525000021_create_cash_flow_v1_3sections_rpc.sql
-- Session 21 / Sub-phase 1.A.2 — Create cash_flow_v1 with 3-section lines.
--
-- The existing `get_cash_flow_v1(date, date)` is the indirect-method RPC
-- used by the BO hook (preserved, no changes). This migration creates a NEW
-- function `cash_flow_v1(date, date)` that returns a flat jsonb with
-- 3-section totals + a `lines` array keyed by accounts.cash_flow_section.
--
-- Returns:
-- {
--   "operating_total":  NUMERIC,
--   "investing_total":  NUMERIC,
--   "financing_total":  NUMERIC,
--   "net_change":       NUMERIC,
--   "lines": [
--     { "section": "operating", "account_code": "...", "account_name": "...", "amount": NUMERIC },
--     ...
--   ]
-- }
--
-- Amount sign convention: positive = cash inflow for that section.
--   net (credit - debit) per account within the date range.

CREATE OR REPLACE FUNCTION public.cash_flow_v1(
  p_from DATE,
  p_to   DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH period_lines AS (
    SELECT
      a.cash_flow_section::TEXT   AS section,
      a.code                       AS account_code,
      a.name                       AS account_name,
      SUM(jel.credit - jel.debit)::NUMERIC(14,2) AS amount
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN accounts a         ON a.id  = jel.account_id
    WHERE je.status    IN ('posted', 'locked')
      AND je.entry_date BETWEEN p_from AND p_to
      AND a.cash_flow_section <> 'none'
      AND a.deleted_at IS NULL
    GROUP BY a.cash_flow_section, a.code, a.name
  ),
  totals AS (
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE section = 'operating'),  0)::NUMERIC(14,2) AS operating_total,
      COALESCE(SUM(amount) FILTER (WHERE section = 'investing'),  0)::NUMERIC(14,2) AS investing_total,
      COALESCE(SUM(amount) FILTER (WHERE section = 'financing'),  0)::NUMERIC(14,2) AS financing_total
    FROM period_lines
  )
  SELECT jsonb_build_object(
    'operating_total', t.operating_total,
    'investing_total', t.investing_total,
    'financing_total', t.financing_total,
    'net_change',      (t.operating_total + t.investing_total + t.financing_total),
    'lines', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'section',      pl.section,
          'account_code', pl.account_code,
          'account_name', pl.account_name,
          'amount',       pl.amount
        ) ORDER BY pl.section, pl.account_code
      ) FROM period_lines pl),
      '[]'::jsonb
    )
  )
  FROM totals t;
$$;

COMMENT ON FUNCTION public.cash_flow_v1(DATE, DATE) IS
  'Session 21 / Sub-phase 1.A.2 — Cash flow 3-section breakdown. '
  'Returns operating_total + investing_total + financing_total + net_change + lines[]. '
  'Amounts are net (credit - debit) per account for the period. '
  'Complements get_cash_flow_v1 (indirect method). Closes D-W6-6A-2.';

-- Defense-in-depth permission pattern (S20 critical pattern).
REVOKE ALL     ON FUNCTION public.cash_flow_v1(DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cash_flow_v1(DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cash_flow_v1(DATE, DATE) TO authenticated;
