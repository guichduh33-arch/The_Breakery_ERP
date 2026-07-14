// supabase/functions/_shared/permissions.ts
// Permissions resolver for Edge Functions — reads from DB tables
// `role_permissions` + `user_permission_overrides`, mirroring the DB-side
// `has_permission()` function (session 13 Phase 1.B D10 lock).
//
// S78 (F-2, finding S71 s43-T2) : le schéma réel de user_permission_overrides
// est `user_profile_id` / `is_granted` (+ `expires_at`), PAS `user_id` /
// `override_type` — la requête historique échouait à CHAQUE login et les
// overrides par-user étaient silencieusement ignorés côté EF (le rôle seul
// faisait foi ; un DENY posé via override n'était pas appliqué aux gates EF
// comme verify-manager-pin). Réaligné VERBATIM sur has_permission() live :
//   1. DENY (is_granted=false, non expiré) retire — il bat tout ;
//   2. grants du rôle (role_permissions.is_granted=true) ;
//   3. GRANT override (is_granted=true, non expiré) ajoute.
//
// Source of truth is the DB. The `auth-verify-pin` and `auth-get-session`
// EFs await this function once per login / session-restore — acceptable
// latency cost because login is a rare event.
//
// Plan ref : docs/workplan/refs/2026-05-14-session-13-wave-6-deviations.md
//            D-W6-PERMS-01 · docs/workplan/plans/2026-07-14-session-78-vitest-d6-plan.md

import { getAdminClient } from './supabase-admin.ts';

/**
 * Compute the effective permission list for a (role, user) pair by querying
 * `role_permissions` and applying `user_permission_overrides`.
 *
 * @param roleCode - `roles.code` for the user (e.g. 'SUPER_ADMIN', 'CASHIER').
 * @param userId   - Optional `user_profiles.id`. If supplied, overrides are
 *                   applied on top of the role grants (DENY beats GRANT,
 *                   expired overrides ignored — mirrors has_permission()).
 */
export async function computePermissionsForRole(
  roleCode: string,
  userId?: string,
): Promise<string[]> {
  const admin = getAdminClient();

  // 1. Role-level grants (is_granted=true only — the column exists here too).
  const { data: roleGrants, error: roleErr } = await admin
    .from('role_permissions')
    .select('permission_code')
    .eq('role_code', roleCode)
    .eq('is_granted', true);

  if (roleErr) {
    console.error('[permissions] role_permissions fetch error', roleErr);
    return [];
  }

  const perms = new Set<string>((roleGrants ?? []).map((r) => r.permission_code as string));

  // 2. User-level overrides — schéma live : user_profile_id / is_granted /
  //    expires_at. DENY beats GRANT ; un override expiré est inerte.
  if (userId) {
    const { data: overrides, error: overrideErr } = await admin
      .from('user_permission_overrides')
      .select('permission_code, is_granted, expires_at')
      .eq('user_profile_id', userId);

    if (overrideErr) {
      console.error('[permissions] overrides fetch error', overrideErr);
    } else {
      const now = Date.now();
      const active = (overrides ?? []).filter((o) => {
        const exp = o.expires_at as string | null;
        return exp === null || Date.parse(exp) > now;
      });
      // GRANTs first, then DENYs so a DENY always wins on the same code.
      for (const o of active) {
        if (o.is_granted === true) perms.add(o.permission_code as string);
      }
      for (const o of active) {
        if (o.is_granted === false) perms.delete(o.permission_code as string);
      }
    }
  }

  return Array.from(perms).sort();
}

/**
 * Convenience wrapper around {@link computePermissionsForRole} for
 * single-permission gates (e.g. `required_permission` in `auth-verify-pin`).
 */
export async function checkPermissionForRole(
  roleCode: string,
  permission: string,
  userId?: string,
): Promise<boolean> {
  const perms = await computePermissionsForRole(roleCode, userId);
  return perms.includes(permission);
}
