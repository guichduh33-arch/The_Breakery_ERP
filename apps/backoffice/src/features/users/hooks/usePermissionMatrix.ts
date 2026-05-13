// apps/backoffice/src/features/users/hooks/usePermissionMatrix.ts
// Session 13 / Phase 5.D — Read-only view of the (role, permission) grant grid.
//
// Source of truth: `role_permissions` table seeded in Phase 1.B. The
// `has_permission()` function is a pure lookup against this table (plus
// `user_permission_overrides`), so the matrix view is equivalent to calling
// `has_permission()` for every (role, permission) pair, but with a single
// query instead of O(R*P) round-trips (see Phase 5.D sub-plan §2 D-W5-5D-05).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface RoleRow {
  code:        string;
  name:        string;
  description: string | null;
  is_system:   boolean;
}

export interface PermissionRow {
  code:        string;
  module:      string;
  action:      string;
  description: string | null;
}

export interface RolePermissionEdge {
  role_code:       string;
  permission_code: string;
  is_granted:      boolean;
}

export interface PermissionMatrix {
  roles:       RoleRow[];
  permissions: PermissionRow[];
  /** Set of "role_codepermission_code" strings for fast lookup. */
  grants:      Set<string>;
}

export const PERMISSION_MATRIX_KEY = ['permission-matrix'] as const;

function key(roleCode: string, permissionCode: string): string {
  return `${roleCode}${permissionCode}`;
}

export function isGranted(matrix: PermissionMatrix | undefined,
                          roleCode: string,
                          permissionCode: string): boolean {
  if (!matrix) return false;
  return matrix.grants.has(key(roleCode, permissionCode));
}

export function usePermissionMatrix() {
  return useQuery<PermissionMatrix>({
    queryKey: PERMISSION_MATRIX_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [rolesRes, permsRes, rpRes] = await Promise.all([
        supabase.from('roles').select('code, name, description, is_system')
          .order('code', { ascending: true }),
        supabase.from('permissions').select('code, module, action, description')
          .order('module', { ascending: true }).order('code', { ascending: true }),
        supabase.from('role_permissions')
          .select('role_code, permission_code, is_granted'),
      ]);
      if (rolesRes.error !== null) throw new Error(rolesRes.error.message);
      if (permsRes.error !== null) throw new Error(permsRes.error.message);
      if (rpRes.error    !== null) throw new Error(rpRes.error.message);

      const grants = new Set<string>();
      for (const row of (rpRes.data as unknown as RolePermissionEdge[]) ?? []) {
        if (row.is_granted) grants.add(key(row.role_code, row.permission_code));
      }
      return {
        roles:       ((rolesRes.data as unknown as RoleRow[]) ?? []),
        permissions: ((permsRes.data as unknown as PermissionRow[]) ?? []),
        grants,
      };
    },
  });
}
