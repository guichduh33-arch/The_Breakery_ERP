// apps/backoffice/src/features/settings/roles/hooks/useCreateRole.ts
//
// ADR-032 — naissance d'un rôle. La RPC est la seule autorité : elle refuse
// toute écriture qui ne vient pas d'un SUPER_ADMIN (`super_admin_only`),
// valide le code, son unicité insensible à la casse (`role_exists`), le nom,
// la description et les bornes du timeout. Le formulaire double ces contrôles
// pour ne pas faire faire l'aller-retour à l'opérateur — il ne les remplace pas.
//
// Les arguments optionnels sont OMIS quand ils sont vides plutôt que posés à
// `null` : la signature les déclare `DEFAULT NULL`, et le COALESCE serveur
// (timeout explicite > timeout du rôle cloné > 30) ne se lit correctement que
// si l'absence reste une absence.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase.js';
import { ROLES_LIST_KEY } from '@/features/users/hooks/useRolesList.js';
import { RBAC_MATRIX_KEY, rbacErrorMessage } from './useRbacMatrix.js';

export interface CreateRoleArgs {
  code:                   string;
  name:                   string;
  /** Vide = pas de description. */
  description:            string | null;
  /** Vide = hérité du rôle cloné, sinon 30 côté serveur. */
  sessionTimeoutMinutes:  number | null;
  /** Vide = rôle vierge de toute permission. */
  cloneFrom:              string | null;
}

interface CreateRoleRpcArgs {
  p_code:                     string;
  p_name:                     string;
  p_description?:             string;
  p_session_timeout_minutes?: number;
  p_clone_from?:              string;
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation<string, Error, CreateRoleArgs>({
    mutationFn: async (args) => {
      const rpcArgs: CreateRoleRpcArgs = {
        p_code: args.code,
        p_name: args.name,
      };
      if (args.description !== null && args.description !== '') {
        rpcArgs.p_description = args.description;
      }
      if (args.sessionTimeoutMinutes !== null) {
        rpcArgs.p_session_timeout_minutes = args.sessionTimeoutMinutes;
      }
      if (args.cloneFrom !== null && args.cloneFrom !== '') {
        rpcArgs.p_clone_from = args.cloneFrom;
      }

      const { data, error } = await supabase.rpc('create_role_v1', rpcArgs);
      if (error !== null) throw new Error(error.message);
      return String(data);
    },
    onSuccess: async (code, vars) => {
      toast.success(
        vars.cloneFrom !== null && vars.cloneFrom !== ''
          ? `Role ${code} created from ${vars.cloneFrom}.`
          : `Role ${code} created.`,
      );
      await qc.invalidateQueries({ queryKey: RBAC_MATRIX_KEY });
      await qc.invalidateQueries({ queryKey: ROLES_LIST_KEY });
    },
    onError: (error) => {
      toast.error(`Could not create the role: ${rbacErrorMessage(error)}`);
    },
  });
}
