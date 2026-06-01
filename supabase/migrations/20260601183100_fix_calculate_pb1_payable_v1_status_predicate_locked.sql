-- 20260601183100_fix_calculate_pb1_payable_v1_status_predicate_locked.sql
-- Audit fix M2 (2026-06-01) — calculate_pb1_payable_v1 summed je.status='posted'
-- only, while GL/TB/P&L/BS all use status IN ('posted','locked'). A locked fiscal
-- period's JEs would be excluded → PB1 owed to PEMDA Bali could under-report for
-- sealed months. Align the predicate. CREATE OR REPLACE (signature unchanged).

CREATE OR REPLACE FUNCTION calculate_pb1_payable_v1(
  p_period_start DATE,
  p_period_end   DATE
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pb1_id      UUID;
  v_pb1_output  DECIMAL(14,2);
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0002';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  v_pb1_id := resolve_mapping_account('SALE_PB1_TAX');

  -- PB1 output = Σ credits on 2110 over period - Σ debits (reversals on voids/refunds).
  -- M2 fix: include 'locked' so sealed-period JEs still count (matches GL/TB/P&L/BS).
  SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    INTO v_pb1_output
    FROM journal_entry_lines jel
    JOIN journal_entries     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status IN ('posted', 'locked');

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end',   p_period_end,
    'pb1_output',   v_pb1_output,
    'pb1_payable',  v_pb1_output,
    'tax_rate',     current_pb1_rate(),
    'tax_regime',   'NON_PKP_BALI_PB1',
    'note',         'NON-PKP — PB1 payable to PEMDA Bali. No VAT input deduction (ADR-003).'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION calculate_pb1_payable_v1(DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_pb1_payable_v1(DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION calculate_pb1_payable_v1(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION calculate_pb1_payable_v1(DATE, DATE) IS
  'F-S26-AC-10 (ADR-003 NON-PKP) + M2 audit fix 2026-06-01: pb1_payable = Σ credits - Σ debits on SALE_PB1_TAX (2110) over period, status IN (posted, locked) to match GL/TB/P&L/BS. No vat_input deduction.';
