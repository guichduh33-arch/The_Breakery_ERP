// apps/backoffice/src/features/settings/roles/hooks/useRbacMatrix.ts
//
// ADR-031 — socle de lecture de l'éditeur RBAC. Un seul aller-retour groupé
// (quatre `select` parallèles) alimente la matrice globale, la fiche de rôle et
// le panneau d'exceptions : `has_permission()` étant une pure lecture de
// `role_permissions` + `user_permission_overrides`, lire ces tables équivaut à
// interroger la fonction pour chaque paire (rôle, permission) sans en payer les
// O(R×P) allers-retours.
//
// Les quatre requêtes partagent la clé `['rbac-matrix']` : c'est elle que les
// trois mutations invalident, et rien d'autre.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

/** Le rôle que le serveur refuse de laisser modifier — garde anti-lockout. */
export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

export interface RbacRole {
  code:                    string;
  name:                    string;
  description:             string | null;
  is_system:               boolean;
  session_timeout_minutes: number;
}

export interface RbacPermission {
  code:        string;
  module:      string;
  action:      string;
  description: string | null;
}

export interface RbacOverride {
  user_profile_id: string;
  permission_code: string;
  is_granted:      boolean;
  reason:          string;
  expires_at:      string | null;
  granted_at:      string;
  granted_by:      string | null;
}

export interface RbacModuleGroup {
  module:      string;
  permissions: RbacPermission[];
}

export interface RbacMatrix {
  roles:       RbacRole[];
  permissions: RbacPermission[];
  /**
   * Clés `role_code<U+0001>permission_code`. Le séparateur est un caractère de
   * contrôle SOH, écrit ici par son échappement : invisible dans un éditeur, il
   * rend la concaténation non ambiguë là où un collage nu ferait de
   * ('ADMIN','X.Y') et ('ADMI','NX.Y') la même clé.
   */
  grants:      Set<string>;
  overrides:   RbacOverride[];
  /** Modules distincts, triés — alimente le filtre « module » de la matrice. */
  modules:     string[];
  /** Permissions groupées par module, dans l'ordre du tri serveur. */
  byModule:    RbacModuleGroup[];
}

export const RBAC_MATRIX_KEY = ['rbac-matrix'] as const;

// Écrit par son échappement, jamais en littéral : un caractère de contrôle
// invisible dans un source est le genre de détail qu'une relecture prend pour
// une coquille — ou qu'un outil de formatage mange.
const SEP = '\u0001';

export function grantKey(roleCode: string, permissionCode: string): string {
  return `${roleCode}${SEP}${permissionCode}`;
}

export function isRoleGranted(
  matrix: RbacMatrix | undefined,
  roleCode: string,
  permissionCode: string,
): boolean {
  if (matrix === undefined) return false;
  return matrix.grants.has(grantKey(roleCode, permissionCode));
}

/** Nombre de permissions accordées à un rôle. */
export function grantedCount(matrix: RbacMatrix | undefined, roleCode: string): number {
  if (matrix === undefined) return 0;
  let n = 0;
  for (const p of matrix.permissions) {
    if (matrix.grants.has(grantKey(roleCode, p.code))) n++;
  }
  return n;
}

// ── Traduction des erreurs serveur ──────────────────────────────────────────
// Les trois RPC lèvent des textes courts, faits pour être reconnus, pas lus.
// On les traduit ici pour que le toast dise à l'opérateur ce qui s'est passé
// plutôt que de lui recracher un identifiant.

const RBAC_ERRORS: [string, string][] = [
  ['super_admin_only',          'Only a super admin can change permissions.'],
  ['super_admin_row_locked',    'SUPER_ADMIN permissions are locked to prevent lockout.'],
  ['super_admin_target_locked', 'A SUPER_ADMIN profile cannot carry an override.'],
  ['invalid_reason',            'The reason must be 3 to 200 characters long.'],
  ['invalid_expiry',            'The expiry date must be in the future.'],
  ['role_not_found',            'Unknown role.'],
  ['permission_not_found',      'Unknown permission.'],
  ['profile_not_found',         'Unknown user profile.'],
];

export function rbacErrorMessage(error: Error): string {
  const raw = error.message;
  for (const [code, human] of RBAC_ERRORS) {
    if (raw.includes(code)) return human;
  }
  return raw;
}

export function useRbacMatrix() {
  return useQuery<RbacMatrix, Error>({
    queryKey: RBAC_MATRIX_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const [rolesRes, permsRes, grantsRes, overridesRes] = await Promise.all([
        supabase
          .from('roles')
          .select('code, name, description, is_system, session_timeout_minutes')
          .order('code', { ascending: true }),
        supabase
          .from('permissions')
          .select('code, module, action, description')
          .order('module', { ascending: true })
          .order('code', { ascending: true }),
        supabase
          .from('role_permissions')
          .select('role_code, permission_code, is_granted'),
        supabase
          .from('user_permission_overrides')
          .select('user_profile_id, permission_code, is_granted, reason, expires_at, granted_at, granted_by'),
      ]);

      if (rolesRes.error     !== null) throw new Error(rolesRes.error.message);
      if (permsRes.error     !== null) throw new Error(permsRes.error.message);
      if (grantsRes.error    !== null) throw new Error(grantsRes.error.message);
      if (overridesRes.error !== null) throw new Error(overridesRes.error.message);

      const roles       = (rolesRes.data     as unknown as RbacRole[])       ?? [];
      const permissions = (permsRes.data     as unknown as RbacPermission[]) ?? [];
      const overrides   = (overridesRes.data as unknown as RbacOverride[])   ?? [];

      const grants = new Set<string>();
      for (const row of (grantsRes.data as unknown as {
        role_code: string; permission_code: string; is_granted: boolean;
      }[]) ?? []) {
        if (row.is_granted) grants.add(grantKey(row.role_code, row.permission_code));
      }

      const byModule: RbacModuleGroup[] = [];
      for (const p of permissions) {
        const last = byModule[byModule.length - 1];
        if (last?.module === p.module) last.permissions.push(p);
        else byModule.push({ module: p.module, permissions: [p] });
      }

      return {
        roles,
        permissions,
        grants,
        overrides,
        modules: byModule.map((g) => g.module),
        byModule,
      } satisfies RbacMatrix;
    },
  });
}
