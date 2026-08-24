// apps/backoffice/src/features/settings/roles/hooks/useSetRolePermission.ts
//
// ADR-031 — bascule d'une case (rôle, permission). La RPC est la seule
// autorité : elle refuse toute écriture qui ne vient pas d'un SUPER_ADMIN
// (`super_admin_only`) et verrouille la ligne SUPER_ADMIN elle-même
// (`super_admin_row_locked`) pour qu'un opérateur ne puisse pas s'enfermer
// dehors. Le front désactive la colonne verrouillée, il ne la remplace pas.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import { RBAC_MATRIX_KEY, rbacErrorMessage } from './useRbacMatrix.js';

export interface SetRolePermissionArgs {
  roleCode:       string;
  permissionCode: string;
  granted:        boolean;
}

export function useSetRolePermission() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, SetRolePermissionArgs>({
    mutationFn: async ({ roleCode, permissionCode, granted }) => {
      const { data, error } = await supabase.rpc('set_role_permission_v1', {
        p_role_code:       roleCode,
        p_permission_code: permissionCode,
        p_granted:         granted,
      });
      if (error !== null) throw new Error(error.message);
      return Boolean(data);
    },
    onSuccess: async (_result, vars) => {
      toast.success(
        vars.granted
          ? `Granted ${vars.permissionCode} to ${vars.roleCode}.`
          : `Revoked ${vars.permissionCode} from ${vars.roleCode}.`,
      );
      await qc.invalidateQueries({ queryKey: RBAC_MATRIX_KEY });
    },
    onError: (error) => {
      toast.error(`Update failed: ${rbacErrorMessage(error)}`);
    },
  });
}
