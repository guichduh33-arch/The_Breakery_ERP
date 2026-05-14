// apps/backoffice/src/features/settings/hooks/usePermissionsMatrix.ts
//
// Session 13 / Phase 5.C — Read-only view of the role -> permission grant
// matrix. Full RBAC editing is deferred to Phase 5.D.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type RoleRow              = Database['public']['Tables']['roles']['Row'];
export type PermissionRow        = Database['public']['Tables']['permissions']['Row'];
export type RolePermissionRow    = Database['public']['Tables']['role_permissions']['Row'];

export interface PermissionsMatrixPayload {
  roles:        RoleRow[];
  permissions:  PermissionRow[];
  grants:       RolePermissionRow[];
}

export const PERMISSIONS_MATRIX_QUERY_KEY = ['permissions-matrix'] as const;

export function usePermissionsMatrix() {
  return useQuery<PermissionsMatrixPayload>({
    queryKey: PERMISSIONS_MATRIX_QUERY_KEY,
    queryFn: async () => {
      const [rolesRes, permsRes, grantsRes] = await Promise.all([
        supabase.from('roles').select('*').order('code', { ascending: true }),
        supabase.from('permissions').select('*').order('code', { ascending: true }),
        supabase.from('role_permissions').select('*'),
      ]);
      if (rolesRes.error)  throw rolesRes.error;
      if (permsRes.error)  throw permsRes.error;
      if (grantsRes.error) throw grantsRes.error;
      return {
        roles:       rolesRes.data  ?? [],
        permissions: permsRes.data  ?? [],
        grants:      grantsRes.data ?? [],
      };
    },
  });
}
