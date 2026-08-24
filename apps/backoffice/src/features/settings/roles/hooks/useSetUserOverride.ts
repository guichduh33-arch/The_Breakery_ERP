// apps/backoffice/src/features/settings/roles/hooks/useSetUserOverride.ts
//
// ADR-031 — exception accordée ou refusée à UNE personne, par-dessus son rôle.
// La raison est obligatoire côté serveur (3-200 caractères, `invalid_reason`) :
// une exception sans motif est une dette d'audit, pas un réglage. L'expiration
// est facultative — omise, l'exception ne s'éteint jamais d'elle-même.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import { RBAC_MATRIX_KEY, rbacErrorMessage } from './useRbacMatrix.js';

export interface SetUserOverrideArgs {
  userProfileId:  string;
  permissionCode: string;
  granted:        boolean;
  reason:         string;
  /** ISO 8601, ou null pour une exception sans échéance. */
  expiresAt?:     string | null;
}

export function useSetUserOverride() {
  const qc = useQueryClient();
  return useMutation<boolean, Error, SetUserOverrideArgs>({
    mutationFn: async ({ userProfileId, permissionCode, granted, reason, expiresAt }) => {
      const base = {
        p_user_profile_id: userProfileId,
        p_permission_code: permissionCode,
        p_granted:         granted,
        p_reason:          reason,
      };
      // `p_expires_at` est un argument à défaut serveur : on l'OMET plutôt que
      // de poster un null, pour laisser le défaut de la signature s'appliquer.
      const hasExpiry = typeof expiresAt === 'string' && expiresAt !== '';
      const { data, error } = hasExpiry
        ? await supabase.rpc('set_user_permission_override_v1', { ...base, p_expires_at: expiresAt })
        : await supabase.rpc('set_user_permission_override_v1', base);
      if (error !== null) throw new Error(error.message);
      return Boolean(data);
    },
    onSuccess: async (_result, vars) => {
      toast.success(
        vars.granted
          ? `Override saved — ${vars.permissionCode} granted.`
          : `Override saved — ${vars.permissionCode} denied.`,
      );
      await qc.invalidateQueries({ queryKey: RBAC_MATRIX_KEY });
    },
    onError: (error) => {
      toast.error(`Override failed: ${rbacErrorMessage(error)}`);
    },
  });
}
