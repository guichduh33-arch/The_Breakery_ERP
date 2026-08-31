-- P0 relevé par l'audit du 2026-08-31 (lot 1, skill expense-governance).
--
-- La policy `expenses_update_owner_or_manager` (posée le 2026-05-17, jamais resserrée
-- quand la chaîne d'approbation est arrivée le 2026-05-24) ouvrait l'UPDATE DIRECT de
-- la table à tout détenteur d'`expenses.manage` — ADMIN, MANAGER, SUPER_ADMIN — sans
-- restriction de colonne ni de transition de statut, en USING **et** en WITH CHECK,
-- avec `GRANT UPDATE ... TO authenticated`. Le commentaire d'origine l'assumait
-- (« Manager+ can update anything »).
--
-- Conséquence prouvée en BEGIN/ROLLBACK le 2026-08-31 : sous les claims d'un MANAGER,
-- `UPDATE expenses SET status='approved', amount=..., required_approval_steps_snapshot='[]'`
-- passe. Soit une dépense approuvée SANS ligne `expense_approvals`, SANS PIN manager,
-- SANS séparation des tâches et SANS écriture comptable — plus la réécriture
-- rétroactive du snapshot que l'invariant « snapshot-at-submit immuable » interdit,
-- et la modification du montant d'une dépense déjà `paid`.
-- Contrôle négatif : le même UPDATE sous un CASHIER touche 0 ligne.
--
-- La gouvernance des dépenses vit dans les RPC (`submit_expense`, `approve_expense`,
-- `reject_expense`, `pay_expense`), toutes SECURITY DEFINER : elles contournent la RLS
-- et ne sont donc PAS affectées par ce resserrement.
--
-- Aucun call-site applicatif ne fait d'UPDATE direct : les deux seuls accès à
-- `.from('expenses')` du dépôt sont des `.select()`
-- (`useExpensesList.ts`, `useExpenseDetail.ts`, apps/backoffice).
--
-- Reste ouvert, hors périmètre de ce correctif : `authenticated` conserve INSERT,
-- DELETE et TRUNCATE sur `expenses` (le TRUNCATE résiduel touche 71 tables du schéma,
-- c'est un chantier systémique à part).

DROP POLICY IF EXISTS expenses_update_owner_or_manager ON public.expenses;

-- Seul le créateur d'un BROUILLON peut l'éditer en direct, et il ne peut pas le faire
-- sortir de `draft` : le WITH CHECK réévalue la LIGNE RÉSULTANTE, ce qui bloque toute
-- promotion de statut par UPDATE nu.
CREATE POLICY expenses_update_own_draft ON public.expenses
  FOR UPDATE
  TO authenticated
  USING (
    status = 'draft'
    AND created_by = (
      SELECT up.id FROM public.user_profiles up
      WHERE up.auth_user_id = auth.uid() AND up.deleted_at IS NULL
      LIMIT 1
    )
  )
  WITH CHECK (
    status = 'draft'
    AND created_by = (
      SELECT up.id FROM public.user_profiles up
      WHERE up.auth_user_id = auth.uid() AND up.deleted_at IS NULL
      LIMIT 1
    )
  );

COMMENT ON POLICY expenses_update_own_draft ON public.expenses IS
  'Direct UPDATE is limited to the author of a draft, and cannot move it out of draft (WITH CHECK re-evaluates the resulting row). Every status transition goes through the SECURITY DEFINER RPCs, which enforce SOD, the manager PIN and the journal entry.';
