-- P0 relevé par l'audit du 2026-08-31 (lot 1, skill security-fraud-guard).
--
-- `view_b2b_invoices` avait perdu `security_invoker`. Une vue sans cette option
-- s'exécute avec les droits de son PROPRIÉTAIRE : les policies RLS de `orders` et de
-- `customers` sont contournées, et tout compte `authenticated` lit le carnet B2B —
-- noms de clients, plafonds, soldes — quel que soit son rôle.
--
-- Régression introduite par `20260808000001_orders_pickup_date.sql` : le
-- `CREATE OR REPLACE VIEW` y est écrit sans clause `WITH (security_invoker = true)`,
-- ce qui EFFACE l'option posée par `20260803000002`. Le `COMMENT ON VIEW` posé juste
-- après dans la même migration affirme pourtant « SECURITY INVOKER » — il ment depuis.
-- C'est `pg_class.reloptions` qui fait foi, jamais le commentaire.
--
-- Effet mesuré le 2026-08-31 sur V3 dev, sous `SET LOCAL ROLE authenticated` avec les
-- claims réels de chaque rôle, en enveloppe BEGIN/ROLLBACK :
--   · ADMIN / SUPER_ADMIN : 22 factures sur 22 — le back-office n'est pas affecté ;
--   · CASHIER            : 0 facture — la fuite est fermée.
-- La vue joint `customers` en INNER JOIN et `customers.auth_read` exige
-- `customers.read`, détenue par ADMIN / MANAGER / SUPER_ADMIN seulement — soit
-- exactement les rôles qui détiennent `b2b.read` et consomment la page B2B du BO.
--
-- Aucun call-site POS : les seuls lecteurs sont les hooks
-- `apps/backoffice/src/features/btob/hooks/useB2bOrdersList|useB2bInvoices|useB2bDashboard|useB2bOrdersCounters`.

ALTER VIEW public.view_b2b_invoices SET (security_invoker = true);

COMMENT ON VIEW public.view_b2b_invoices IS
  'B2B invoices derived from orders + customers. SECURITY INVOKER (verify with pg_class.reloptions, not this comment): callers see only what customers.auth_read and orders.auth_read allow them to see. A CREATE OR REPLACE VIEW without WITH (security_invoker = true) silently drops it.';
