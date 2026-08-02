-- Lot 1 — Les ledgers append-only gardaient des GRANT d ecriture residuels.
--
-- Douze tables accordaient encore a `authenticated` des privileges d ecriture
-- qu aucune d elles n utilise : TRUNCATE pour toutes, plus INSERT/UPDATE/DELETE
-- pour les quatre tables de la famille paiement/remboursement.
--
-- Aucune de ces douze tables ne porte de policy d ecriture : le DML etait donc
-- deja refuse par la RLS, et PostgREST n expose pas TRUNCATE. Ces GRANT ne sont
-- pas une faille exploitable en l etat — c est une couche de defense manquante,
-- et surtout une divergence avec le modele que le projet tient deja ailleurs :
-- stock_movements, purchase_payments, display_movements, b2b_payment_allocations
-- et customer_store_credit_ledger n accordent que SELECT. Les douze autres ont
-- derive au fil des sessions.
--
-- TRUNCATE merite une mention particuliere : il ne declenche pas les triggers
-- ROW, donc les gardes pos_events_no_delete et consorts ne le verraient pas
-- passer. Un ledger qu on peut vider ne prouve rien.
--
-- Sans effet fonctionnel attendu : les ecritures passent toutes par des RPC
-- SECURITY DEFINER, qui s executent avec les droits du proprietaire.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE
  public.audit_logs,
  public.b2b_payments,
  public.expense_approvals,
  public.journal_entries,
  public.journal_entry_lines,
  public.loyalty_transactions,
  public.order_payments,
  public.pos_events,
  public.refunds,
  public.refund_lines,
  public.refund_payments,
  public.z_reports
FROM PUBLIC, anon, authenticated;

-- Trois helpers internes restaient executables par `authenticated` via
-- /rest/v1/rpc/. Ils ne sont appeles que depuis des fonctions SECURITY DEFINER
-- (verifie : zero appelant SECURITY INVOKER) et par aucun code applicatif, donc
-- la revocation ne casse aucun chemin. Le prefixe « _ » annonce un helper : il
-- doit cesser d etre une promesse pour devenir un fait.
REVOKE EXECUTE ON FUNCTION public._next_b2b_invoice_number_v1() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._resolve_combo_modifier_ingredients_v1(jsonb, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._revoke_user_sessions_v1(uuid) FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
