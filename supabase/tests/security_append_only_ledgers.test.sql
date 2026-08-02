-- Lot 1 — Les ledgers append-only n accordent aucune ecriture a un role client.
--
-- Invariant : sur un ledger append-only, `authenticated` ne doit porter que
-- SELECT. Les ecritures passent par des RPC SECURITY DEFINER, qui s executent
-- avec les droits du proprietaire et n ont donc pas besoin du GRANT de table.
--
-- Avant 20260803000001, douze tables gardaient des GRANT residuels : TRUNCATE
-- pour toutes, plus INSERT/UPDATE/DELETE pour la famille paiement/remboursement.
-- Aucune n avait de policy d ecriture, donc le DML etait deja refuse par la RLS
-- et TRUNCATE n est pas expose par PostgREST : ce n etait pas une faille
-- exploitable, mais une couche de defense manquante et une divergence avec
-- stock_movements, purchase_payments et display_movements, qui eux tenaient la
-- regle.
--
-- TRUNCATE compte double : il ne declenche pas les triggers ROW, donc les
-- gardes d immuabilite poses ligne a ligne ne le verraient pas passer.
--
-- La liste est explicite plutot que deduite : un ledger nouvellement cree doit
-- etre ajoute ici sciemment, et non herite d une heuristique de nommage qui le
-- couvrirait en silence.
BEGIN;

SELECT plan(2);

SELECT is_empty(
  $$ SELECT g.table_name, g.grantee, g.privilege_type
       FROM information_schema.role_table_grants g
       JOIN pg_class c ON c.relname = g.table_name
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE g.table_schema = 'public'
        AND g.grantee IN ('anon', 'authenticated', 'PUBLIC')
        AND g.privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
        AND g.table_name IN (
          'audit_logs', 'b2b_payments', 'b2b_payment_allocations',
          'customer_store_credit_ledger', 'display_movements', 'expense_approvals',
          'journal_entries', 'journal_entry_lines', 'loyalty_transactions',
          'order_payments', 'pos_events', 'purchase_payments', 'refunds',
          'refund_lines', 'refund_payments', 'stock_movements', 'z_reports'
        ) $$,
  'aucun ledger append-only n accorde INSERT/UPDATE/DELETE/TRUNCATE a un role client'
);

-- Garde-fou inverse : la revocation ne doit pas avoir emporte la lecture, sans
-- quoi les rapports et les ecrans d historique s eteindraient en silence.
SELECT is_empty(
  $$ SELECT t.tbl
       FROM unnest(ARRAY['audit_logs','journal_entries','journal_entry_lines',
                         'order_payments','refunds','z_reports']) AS t(tbl)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.role_table_grants g
         WHERE g.table_schema = 'public' AND g.table_name = t.tbl
           AND g.grantee = 'authenticated' AND g.privilege_type = 'SELECT'
      ) $$,
  'les ledgers restent lisibles par authenticated (RLS seule gouverne le filtrage)'
);

SELECT * FROM finish();
ROLLBACK;
