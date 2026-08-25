// apps/backoffice/src/features/settings/roles/hooks/useDeleteRole.ts
//
// ADR-032 — mort d'un rôle créé à la main. Trois refus serveur que l'écran ne
// peut que devancer, jamais remplacer : `system_role_locked` (rôle système),
// `role_in_use` (des profils le portent encore — soft-deleted compris, la FK
// les retient aussi) et `role_not_found`.
//
// Le DETAIL de `role_in_use` porte le compte des porteurs : on le recolle au
// message pour qu'une erreur non traduite arrive entière dans le toast.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import { ROLES_LIST_KEY } from '@/features/users/hooks/useRolesList.js';
import { RBAC_MATRIX_KEY, rbacErrorMessage } from './useRbacMatrix.js';

export interface DeleteRoleArgs {
  code: string;
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, DeleteRoleArgs>({
    mutationFn: async ({ code }) => {
      const { data, error } = await supabase.rpc('delete_role_v1', { p_code: code });
      if (error !== null) {
        const detail = typeof error.details === 'string' && error.details !== ''
          ? ` (${error.details})`
          : '';
        throw new Error(`${error.message}${detail}`);
      }
      return Boolean(data);
    },
    onSuccess: async (_result, vars) => {
      toast.success(`Role ${vars.code} deleted.`);
      await qc.invalidateQueries({ queryKey: RBAC_MATRIX_KEY });
      await qc.invalidateQueries({ queryKey: ROLES_LIST_KEY });
    },
    onError: (error) => {
      toast.error(`Could not delete the role: ${rbacErrorMessage(error)}`);
    },
  });
}
