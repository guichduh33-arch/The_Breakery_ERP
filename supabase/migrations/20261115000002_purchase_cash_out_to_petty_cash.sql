-- 20261115000002 — Les paiements fournisseurs en espèces sortent de la Petite caisse.
-- Décision de Mamat (2026-11-15) : toute dépense payée cash est déduite du compte
-- 1111 Petty Cash, jamais du 1110 (portefeuille « Undeposited Funds »).
-- Les dépenses (EXPENSE_CASH_OUT) y sont déjà depuis 20260706000019. Restait le
-- paiement de bon de commande en cash : `_record_po_payment_internal` (paiement
-- manuel et auto-paiement des PO cash à la réception) et le plan d'import
-- historique résolvent PURCHASE_CASH_OUT, encore pointé sur 1110.
-- Forward-only : les écritures déjà postées ne sont pas modifiées.

UPDATE accounting_mappings
   SET account_code = '1111',
       description  = 'PO paid cash -> CR Petty Cash (all cash spending leaves the petty cash wallet)'
 WHERE mapping_key = 'PURCHASE_CASH_OUT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounting_mappings
                  WHERE mapping_key = 'PURCHASE_CASH_OUT' AND account_code = '1111') THEN
    RAISE EXCEPTION 'PURCHASE_CASH_OUT mapping missing or not remapped to 1111';
  END IF;
END $$;
