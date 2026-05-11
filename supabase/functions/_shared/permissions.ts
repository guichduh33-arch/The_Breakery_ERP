// supabase/functions/_shared/permissions.ts
// Single source of truth for role → permissions mapping in Edge Functions.
// Imported by auth-verify-pin and auth-get-session (D10 — session 8 perf-debt).
//
// IMPORTANT: this list must stay in sync with the DB-side `has_permission()`
// function (last reset in 20260513000004_seed_backoffice_crud_perms.sql v5).
// Any role/permission referenced by an EF or RLS policy MUST appear here,
// otherwise the EF response and DB authorisation will diverge.
//
// Role-code casing is intentional :
//   - 'SUPER_ADMIN' / 'ADMIN' / 'MANAGER' / 'CASHIER' : uppercase (legacy seed)
//   - 'waiter'                                        : lowercase (session 5 seed,
//                                                       see 20260507000002_seed_waiter_role.sql)

const MANAGER_PERMS: readonly string[] = [
  // Sessions 1-2 — POS core
  'pos.session.open', 'pos.session.close_own', 'pos.session.close_other',
  'pos.session.view_all', 'pos.sale.create', 'pos.sale.void', 'pos.sale.update',
  // Session 1 — products read/create/update (delete is admin-only)
  'products.read', 'products.create', 'products.update',
  // Session 5 — payments
  'payments.process',
  // Session 6 — discounts
  'sales.discount',
  // Session 9 — promotions (BO2): MANAGER gets read+create+update (NO delete)
  'promotions.read', 'promotions.create', 'promotions.update',
  // Session 10 — refund + cancel-after-send
  'pos.sale.refund', 'pos.sale.cancel_item',
  // Session 11 — backoffice CRUDs (read+create+update for MANAGER ; delete is admin-only ;
  // customer_categories + discount_templates are admin-only entirely)
  'categories.read', 'categories.create', 'categories.update',
  'customers.read', 'customers.create', 'customers.update',
  'tables.read', 'tables.create', 'tables.update',
  'combos.read', 'combos.create', 'combos.update',
  'suppliers.read', 'suppliers.create', 'suppliers.update',
];

const ADMIN_DELTA: readonly string[] = [
  // Admins also see the deletes + admin-tier-only modules
  'users.create', 'users.update', 'users.view_audit',
  'promotions.delete',
  'products.delete',
  'categories.delete',
  'customers.delete',
  'customer_categories.read', 'customer_categories.create',
  'customer_categories.update', 'customer_categories.delete',
  'tables.delete',
  'combos.delete',
  'discount_templates.read', 'discount_templates.create',
  'discount_templates.update', 'discount_templates.delete',
  'suppliers.delete',
];

export function computePermissionsForRole(role: string): string[] {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return [...MANAGER_PERMS, ...ADMIN_DELTA];
    case 'MANAGER':
      return [...MANAGER_PERMS];
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
