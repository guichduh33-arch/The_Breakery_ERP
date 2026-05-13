-- 20260517000212_create_cash_flow_rpc.sql
-- Session 13 / Phase 6.A — Cash Flow Statement RPC (indirect method).
--
-- RPC `get_cash_flow_v1(p_date_start, p_date_end)`. Returns JSONB:
--
--   {
--     "operating": {
--       "net_profit":            N,
--       "delta_ar":              N,   -- decrease in AR adds cash
--       "delta_ap":              N,   -- increase in AP adds cash
--       "delta_inventory":       N,   -- decrease in inventory adds cash
--       "non_cash_adjustments":  0,   -- depreciation etc. — zero placeholder
--       "total":                 N
--     },
--     "investing": { "total": 0 },     -- placeholder (D-W6-6A-2)
--     "financing": { "total": 0 },     -- placeholder (D-W6-6A-2)
--     "net_change_in_cash":      N,
--     "cash_start":              N,
--     "cash_end":                N,
--     "period": { "start": "...", "end": "..." }
--   }
--
-- DELTA SIGN CONVENTION (indirect method):
--   - Cash from Operating = NetIncome - Δ(AR) - Δ(Inventory) + Δ(AP).
--   - Δ(AR) = AR_end - AR_start (positive means AR grew → consumes cash).
--   - We report `delta_ar` etc. as the ADJUSTMENT (after sign flip), so:
--       delta_ar         = -(AR_end - AR_start)
--       delta_inventory  = -(Inv_end - Inv_start)
--       delta_ap         = +(AP_end - AP_start)
--   - This way `operating.total = net_profit + delta_ar + delta_ap + delta_inventory`.
--
-- AR/AP/Inv balances are pulled by calling the existing classification logic
-- (account codes 113%/114%/2141) directly — does NOT call get_balance_sheet_v1
-- because we need start-of-period AND end-of-period balances and want a
-- single query plan.
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-6.A-reports-cascade.md

CREATE OR REPLACE FUNCTION public.get_cash_flow_v1(
  p_date_start DATE,
  p_date_end   DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_net_profit       NUMERIC(14,2) := 0;
  v_revenue          NUMERIC(14,2) := 0;
  v_cogs             NUMERIC(14,2) := 0;
  v_opex             NUMERIC(14,2) := 0;

  v_ar_start         NUMERIC(14,2) := 0;
  v_ar_end           NUMERIC(14,2) := 0;
  v_ap_start         NUMERIC(14,2) := 0;
  v_ap_end           NUMERIC(14,2) := 0;
  v_inv_start        NUMERIC(14,2) := 0;
  v_inv_end          NUMERIC(14,2) := 0;
  v_cash_start       NUMERIC(14,2) := 0;
  v_cash_end         NUMERIC(14,2) := 0;

  v_delta_ar         NUMERIC(14,2) := 0;
  v_delta_ap         NUMERIC(14,2) := 0;
  v_delta_inv        NUMERIC(14,2) := 0;
  v_operating_total  NUMERIC(14,2) := 0;
  v_net_change       NUMERIC(14,2) := 0;

  v_prior_end DATE;
BEGIN
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_cash_flow_v1: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_cash_flow_v1: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  v_prior_end := (p_date_start - INTERVAL '1 day')::DATE;

  -- Period net profit (= revenue - COGS - OpEx).
  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0)
  INTO v_revenue, v_cogs, v_opex
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND a.account_class IN (4, 5, 6);

  v_net_profit := (v_revenue - v_cogs - v_opex)::NUMERIC(14,2);

  -- AR/AP/Inventory balances at start (= prior day) and end of period.
  -- AR  = 113% (debit-normal)   → balance = SUM(debit - credit)
  -- INV = 114% (debit-normal)   → balance = SUM(debit - credit)
  -- AP  = 2141  (credit-normal) → balance = SUM(credit - debit)
  -- Cash = 111% (debit-normal)  → balance = SUM(debit - credit)
  SELECT
    COALESCE(SUM(CASE WHEN a.code LIKE '113%' AND je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '113%' AND je.entry_date <= p_date_end  THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '114%' AND je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '114%' AND je.entry_date <= p_date_end  THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2141'    AND je.entry_date <= v_prior_end THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2141'    AND je.entry_date <= p_date_end  THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '111%' AND je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '111%' AND je.entry_date <= p_date_end  THEN (jel.debit - jel.credit) END), 0)
  INTO
    v_ar_start, v_ar_end, v_inv_start, v_inv_end,
    v_ap_start, v_ap_end, v_cash_start, v_cash_end
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date <= p_date_end
    AND (a.code LIKE '111%' OR a.code LIKE '113%' OR a.code LIKE '114%' OR a.code = '2141');

  -- Indirect-method adjustments (sign-flipped so they ADD into the total).
  v_delta_ar  := (-(v_ar_end  - v_ar_start ))::NUMERIC(14,2);
  v_delta_inv := (-(v_inv_end - v_inv_start))::NUMERIC(14,2);
  v_delta_ap  := ( (v_ap_end  - v_ap_start ))::NUMERIC(14,2);

  v_operating_total := (v_net_profit + v_delta_ar + v_delta_ap + v_delta_inv)::NUMERIC(14,2);
  v_net_change      := v_operating_total; -- investing+financing both 0 (MVP).

  RETURN jsonb_build_object(
    'operating', jsonb_build_object(
      'net_profit',           v_net_profit,
      'delta_ar',             v_delta_ar,
      'delta_ap',             v_delta_ap,
      'delta_inventory',      v_delta_inv,
      'non_cash_adjustments', 0::NUMERIC(14,2),
      'total',                v_operating_total
    ),
    'investing', jsonb_build_object('total', 0::NUMERIC(14,2)),
    'financing', jsonb_build_object('total', 0::NUMERIC(14,2)),
    'net_change_in_cash', v_net_change,
    'cash_start',         v_cash_start,
    'cash_end',           v_cash_end,
    'period', jsonb_build_object(
      'start', p_date_start,
      'end',   p_date_end
    )
  );
END;
$$;

COMMENT ON FUNCTION public.get_cash_flow_v1(DATE, DATE) IS
  'Phase 6.A — Cash Flow Statement (indirect method, MVP). Operating '
  'section computed from net profit + Δ(AR) + Δ(AP) + Δ(Inventory). '
  'Investing + Financing return zero placeholders (D-W6-6A-2).';

GRANT EXECUTE ON FUNCTION public.get_cash_flow_v1(DATE, DATE) TO authenticated;
