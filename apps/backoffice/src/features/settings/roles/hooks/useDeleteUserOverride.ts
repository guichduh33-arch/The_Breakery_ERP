// apps/backoffice/src/features/settings/roles/hooks/useDeleteUserOverride.ts
//
// ADR-031 — retrait d'une exception. La personne retombe alors sur les
// permissions de son rôle, ni plus ni moins. Le retrait est audité côté
// serveur ; le front demande une confirmation parce que rien ne le défait.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import { RBAC_MATRIX_KEY, rbacErrorMessage } from './useRbacMatrix.js';

export interface DeleteUserOverrideArgs {
  userProfileId:  string;
  permissionCode: string;
}

export function useDeleteUserOverride() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, DeleteUserOverrideArgs>({
    mutationFn: async ({ userProfileId, permissionCode }) => {
      const { data, error } = await supabase.rpc('delete_user_permission_override_v1', {
        p_user_profile_id: userProfileId,
        p_permission_code: permissionCode,
      });
      if (error !== null) throw new Error(error.message);
      return Boolean(data);
    },
    onSuccess: async (_result, vars) => {
      toast.success(`Override removed — ${vars.permissionCode}.`);
      await qc.invalidateQueries({ queryKey: RBAC_MATRIX_KEY });
    },
    onError: (error) => {
      toast.error(`Removal failed: ${rbacErrorMessage(error)}`);
    },
  });
}
