// supabase/functions/_shared/permissions.ts
// Permissions resolver for Edge Functions — reads from DB tables
// `role_permissions` + `user_permission_overrides`, mirroring the DB-side
// `has_permission()` function (session 13 Phase 1.B D10 lock).
//
// Replaced the previous hardcoded switch (sessions 1-11) that drifted from
// the actual seeded permissions on staging — Session 13 added ~65 new
// permission codes (accounting, reports, expenses, inventory, purchasing.po,
// settings, users.read, rbac, lan.devices, print_queue, etc.) which the
// static list never picked up. The drift surfaced during Session-13 close-out
// smoke test (D-W6-CICD-01 + D-W6-PERMS-01) when the sidebar filtered out
// every new BO page even for SUPER_ADMIN.
//
// Source of truth is now the DB. The `auth-verify-pin` and `auth-get-session`
// EFs await this function once per login / session-restore — acceptable
// latency cost because login is a rare event.
//
// Plan ref : docs/workplan/refs/2026-05-14-session-13-wave-6-deviations.md
//            D-W6-PERMS-01

import { getAdminClient } from './supabase-admin.ts';

/**
 * Compute the effective permission list for a (role, user) pair by querying
 * `role_permissions` and applying `user_permission_overrides`.
 *
 * - Role grants seed the set.
 * - `user_permission_overrides.override_type='GRANT'` adds entries.
 * - `user_permission_overrides.override_type='DENY'` removes entries
 *   (DENY beats GRANT, mirroring `has_permission()` SQL logic).
 *
 * @param roleCode - `roles.code` for the user (e.g. 'SUPER_ADMIN', 'CASHIER').
 * @param userId   - Optional `user_profiles.id`. If supplied, overrides are
 *                   applied on top of the role grants.
 */
export async function computePermissionsForRole(
  roleCode: string,
  userId?: string,
): Promise<string[]> {
  const admin = getAdminClient();

  // 1. Role-level grants
  const { data: roleGrants, error: roleErr } = await admin
    .from('role_permissions')
    .select('permission_code')
    .eq('role_code', roleCode);

  if (roleErr) {
    console.error('[permissions] role_permissions fetch error', roleErr);
    return [];
  }

  const perms = new Set<string>((roleGrants ?? []).map((r) => r.permission_code as string));

  // 2. User-level overrides (DENY beats GRANT, last-wins on duplicate keys)
  if (userId) {
    const { data: overrides, error: overrideErr } = await admin
      .from('user_permission_overrides')
      .select('permission_code, override_type')
      .eq('user_id', userId);

    if (overrideErr) {
      console.error('[permissions] overrides fetch error', overrideErr);
    } else {
      for (const o of overrides ?? []) {
        const code = o.permission_code as string;
        const type = o.override_type as string;
        if (type === 'GRANT') perms.add(code);
        else if (type === 'DENY') perms.delete(code);
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
