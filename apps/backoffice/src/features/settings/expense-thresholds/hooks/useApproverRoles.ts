// apps/backoffice/src/features/settings/expense-thresholds/hooks/useApproverRoles.ts
//
// Audit expense-governance 2026-08-31, finding n°5 (P1) — la liste des rôles proposée par
// le formulaire de palier était une constante en dur qui offrait CASHIER, lequel ne détient
// pas `expenses.approve`. Un palier configuré ainsi produisait une étape que PERSONNE ne
// pouvait satisfaire : les dépenses de la tranche gelaient en `submitted`, sans re-soumission
// possible après rejet.
//
// La liste vient donc désormais de la base : les rôles porteurs de `expenses.approve`.
// La validation qui compte est côté serveur (`set_expense_threshold`, qui refuse une étape
// sans approbateur possible) — cet écran ne fait qu'éviter à l'opérateur de composer une
// configuration que le serveur rejettera.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export const APPROVER_ROLES_KEY = ['approver-roles', 'expenses.approve'] as const;

export function useApproverRoles() {
  return useQuery<string[]>({
    queryKey: APPROVER_ROLES_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('role_code')
        .eq('permission_code', 'expenses.approve')
        .eq('is_granted', true)
        .order('role_code', { ascending: true });
      if (error !== null) throw new Error(error.message);
      return ((data ?? []) as { role_code: string }[]).map((r) => r.role_code);
    },
  });
}
