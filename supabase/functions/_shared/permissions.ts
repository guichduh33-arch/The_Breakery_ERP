// supabase/functions/_shared/permissions.ts
// Single source of truth for role → permissions mapping in Edge Functions.
// Imported by auth-verify-pin and auth-get-session (D10 — session 8 perf-debt).
//
// IMPORTANT: this list must stay in sync with the DB-side `has_permission()`
// function (last reseted in 20260511000006_seed_promotions_perms_and_demo.sql).
// Any role/permission referenced by an EF or RLS policy MUST appear here,
// otherwise the EF response and DB authorisation will diverge.
//
// Role-code casing is intentional :
//   - 'SUPER_ADMIN' / 'ADMIN' / 'MANAGER' / 'CASHIER' : uppercase (legacy seed)
//   - 'waiter'                                        : lowercase (session 5 seed,
//                                                       see 20260507000002_seed_waiter_role.sql)

export function computePermissionsForRole(role: string): string[] {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      // Admin tier — DB has_permission() returns true unconditionally.
      // We list the same permissions as MANAGER+ so the EF response is explicit.
      return [
        'pos.session.open', 'pos.session.close_own', 'pos.session.close_other',
        'pos.session.view_all', 'pos.sale.create', 'pos.sale.void', 'pos.sale.update',
        'products.read', 'products.create', 'products.update',
        'users.create', 'users.update', 'users.view_audit',
        'payments.process', 'sales.discount',
        // Session 9 — promotions backoffice (BO2): admin tier gets all 4.
        'promotions.read', 'promotions.create', 'promotions.update', 'promotions.delete',
      ];
    case 'MANAGER':
      return [
        'pos.session.open', 'pos.session.close_own', 'pos.session.close_other',
        'pos.session.view_all', 'pos.sale.create', 'pos.sale.void', 'pos.sale.update',
        'products.read', 'products.create', 'products.update',
        'payments.process', 'sales.discount',
        // Session 9 — promotions backoffice (BO2): MANAGER gets read+create+update (NO delete).
        'promotions.read', 'promotions.create', 'promotions.update',
      ];
    case 'CASHIER':
      return [
        'pos.session.open', 'pos.session.close_own',
        'pos.sale.create', 'products.read',
        'payments.process',
      ];
    case 'waiter':
      // Session 5 — tablet/floor staff. Spec A3 : sales.create only, NO payments.
      return ['sales.create', 'products.read'];
    default:
      return [];
  }
}

export function checkPermissionForRole(role: string, permission: string): boolean {
  return computePermissionsForRole(role).includes(permission);
}
