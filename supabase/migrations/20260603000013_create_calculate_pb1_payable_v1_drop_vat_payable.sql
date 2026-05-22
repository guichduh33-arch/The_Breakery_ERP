-- 20260603000013_create_calculate_pb1_payable_v1_drop_vat_payable.sql
-- Session 26 / Wave 1.D / migration _013 :
--   Bump calculate_vat_payable → calculate_pb1_payable_v1 (NON-PKP simplifié)
--   + DROP ancienne signature dans la même migration (RPC versioning rule).
--
-- Closes audit finding F-S26-AC-10 (new, ADR-003 NON-PKP).
--
-- Avant : calculate_vat_payable(date, date) RETURNS JSONB
--   pb1_payable = vat_output - vat_input
--   (formule PKP qui soustrait le VAT input — fictif pour non-PKP)
--
-- Après : calculate_pb1_payable_v1(date, date) RETURNS JSONB
--   pb1_payable = pb1_output
--   (formule NON-PKP — pas de soustraction d input ; le PPN supplier est
--    folded dans inventory cost via F-S26-AC-09, pas un crédit récupérable)
--
-- Rationale : sur la période, vat_input n est plus émis par les triggers
-- (Wave 1.C l a folded dans INVENTORY_GENERAL), donc même si on gardait la
-- formule (output - input), input serait 0. Mais pour clarté sémantique
-- (et pour archive des JE pré-1.C qui pourraient avoir 1151 ≠ 0), on renomme.
--
-- Le rapport retourne aussi 'pb1_output' pour audit + 'period_*' pour traçabilité.

DROP FUNCTION IF EXISTS calculate_vat_payable(DATE, DATE);

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

  -- PB1 output = Σ credits on 2110 over period (PB1 collected on sales)
  --              - Σ debits  on 2110 over period (PB1 reversals on voids/refunds)
  -- Net positive = owed to PEMDA Bali.
  SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    INTO v_pb1_output
    FROM journal_entry_lines jel
    JOIN journal_entries     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status = 'posted';

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
  'F-S26-AC-10 (ADR-003 NON-PKP). Remplace calculate_vat_payable. '
  'pb1_payable = Σ credits on SALE_PB1_TAX (2110) - Σ debits over period. '
  'Pas de soustraction vat_input (non récupérable, folded in inventory cost). '
  'Retourne aussi le tax_rate effectif et un tax_regime label pour les rapports.';
