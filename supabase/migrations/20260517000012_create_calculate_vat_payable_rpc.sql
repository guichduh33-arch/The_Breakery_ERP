-- 20260517000012_create_calculate_vat_payable_rpc.sql
-- Session 13 / Phase 1.A / migration 10-005 :
--   calculate_vat_payable(p_period_start DATE, p_period_end DATE) RETURNS JSONB
--   Build-from-scratch — no V3 predecessor (verified : grep returns 0 hit).
--
-- Output : { vat_output, vat_input, vat_payable, period_start, period_end }
--   vat_output  = Σ credits on resolve_mapping_account('SALE_PB1_TAX')   over period (PB1 collected on sales)
--   vat_input   = Σ debits  on resolve_mapping_account('PURCHASE_VAT_INPUT') over period (VAT paid on purchases)
--   vat_payable = vat_output - vat_input (positive = owed to tax authority)

CREATE OR REPLACE FUNCTION calculate_vat_payable(
  p_period_start DATE,
  p_period_end   DATE
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_pb1_id      UUID;
  v_vat_in_id   UUID;
  v_vat_output  DECIMAL(14,2);
  v_vat_input   DECIMAL(14,2);
BEGIN
  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0002';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  v_pb1_id    := resolve_mapping_account('SALE_PB1_TAX');
  v_vat_in_id := resolve_mapping_account('PURCHASE_VAT_INPUT');

  SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    INTO v_vat_output
    FROM journal_entry_lines jel
    JOIN journal_entries     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status = 'posted';

  SELECT COALESCE(SUM(jel.debit) - SUM(jel.credit), 0)
    INTO v_vat_input
    FROM journal_entry_lines jel
    JOIN journal_entries     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_vat_in_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status = 'posted';

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end',   p_period_end,
    'vat_output',   v_vat_output,
    'vat_input',    v_vat_input,
    'vat_payable',  v_vat_output - v_vat_input
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION calculate_vat_payable(DATE, DATE) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION calculate_vat_payable(DATE, DATE) TO authenticated;

COMMENT ON FUNCTION calculate_vat_payable(DATE, DATE) IS
  '10-005 (build-from-scratch). Returns VAT output (PB1 + VAT_OUTPUT collected) — '
  'VAT input over the period. Uses resolve_mapping_account so a COA reshuffle '
  'never breaks the report.';
