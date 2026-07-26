-- ADR-013 Lot 4 (PR UI) — resserrage RLS lecture du ledger d'avoir.
-- La policy posée en _233 (USING true) laissait tout rôle authentifié (cashier
-- inclus) lire l'historique d'avoir de tous les clients via PostgREST. Aligné
-- sur la table customers : lecture réservée à customers.read (MANAGER+). Le POS
-- ne lit pas le ledger (solde via search_customers_v4).

DROP POLICY IF EXISTS scl_auth_read ON public.customer_store_credit_ledger;
CREATE POLICY scl_auth_read ON public.customer_store_credit_ledger
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'customers.read'));
