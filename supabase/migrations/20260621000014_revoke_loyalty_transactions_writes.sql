-- 20260621000014_revoke_loyalty_transactions_writes.sql
-- Session 37 / Wave A / Task A3 (SEC-04).
-- loyalty_transactions devient append-only au niveau rôle : la table n'avait que la RLS,
-- aucun REVOKE role-level — un client authenticated pouvait INSERT/UPDATE/DELETE direct.
-- Les écritures passent uniquement par les RPCs SECURITY DEFINER (owner postgres),
-- qui ne sont pas affectées par ce REVOKE.

REVOKE INSERT, UPDATE, DELETE ON public.loyalty_transactions FROM authenticated, anon, PUBLIC;
