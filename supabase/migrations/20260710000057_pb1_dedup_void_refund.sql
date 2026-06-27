-- S50 Vague 2a-i · T1 — PB1 dédup void+refund
-- calculate_pb1_payable_v1 sommait Σ(credit−debit) sur 2110 sans exclure la JE
-- sale_void quand un refund existe pour le même order → double contre-passement
-- de 2110 → PB1 sous-déclaré (PEMDA Bali). Reproduit le filtre canonique déjà
-- appliqué par get_profit_loss_v2 / get_balance_sheet (S26 _017/_018).
-- Signature + forme de retour inchangées (bugfix report STABLE) → CREATE OR REPLACE en place.

CREATE OR REPLACE FUNCTION public.calculate_pb1_payable_v1(p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- PB1 output = Σ credits on 2110 over period − Σ debits (reversals on voids/refunds).
  -- Dédup (S50 Vague 2a-i) : exclure la JE sale_void quand un refund existe pour le
  -- même order — sinon void + refund contre-passent 2110 deux fois → PB1 sous-déclaré.
  -- Mirror exact de get_profit_loss_v2 (S26 _017/_018).
  SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    INTO v_pb1_output
    FROM journal_entry_lines jel
    JOIN journal_entries     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status IN ('posted', 'locked')
      AND NOT (je.reference_type = 'sale_void'
               AND EXISTS (SELECT 1 FROM refunds rf WHERE rf.order_id = je.reference_id));

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
$function$;
