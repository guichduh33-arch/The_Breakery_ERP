-- Même garde PIN restrictive que les autres tables RLS publiques.
-- Les droits directs restent révoqués ; l'accès métier reste réservé aux RPC.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'bank_reconciliations',
    'bank_statement_imports',
    'bank_statement_lines',
    'bank_reconciliation_matches',
    'bank_reconciliation_bank_claims',
    'bank_reconciliation_gl_claims',
    'bank_reconciliation_operations',
    'bank_reconciliation_entries',
    'bank_reconciliation_clearing_claims',
    'bank_reconciliation_transit',
    'bank_reconciliation_entry_bank_claims',
    'bank_reconciliation_net_fee_claims'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY pin_session_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.request_has_active_pin_session_v1())) WITH CHECK ((SELECT public.request_has_active_pin_session_v1()))',
      v_table);
  END LOOP;
END;
$$;
