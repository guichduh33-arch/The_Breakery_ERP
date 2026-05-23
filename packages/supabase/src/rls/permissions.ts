// Helper côté client : vérifie une permission contre la liste retournée
// par auth-verify-pin (cachée dans authStore). Pas de roundtrip serveur.

/**
 * Closed set of permission identifiers granted by roles in the `permissions`
 * table. Mirrors the server-side seed (`supabase/migrations/*_init_auth.sql`).
 *
 * Permission semantics:
 * - `pos.session.*`    - Open/close shifts, view other cashiers' sessions.
 * - `pos.sale.*`       - Create/void/update orders at the POS.
 * - `products.*`       - Read or mutate the catalog.
 * - `users.*`          - Manage user_profiles and audit log access.
 */
export type PermissionCode =
  | 'pos.session.open'
  | 'pos.session.close_own'
  | 'pos.session.close_other'
  | 'pos.session.view_all'
  | 'pos.sale.create'
  | 'pos.sale.void'
  | 'pos.sale.update'
  | 'products.read'
  | 'products.create'
  | 'products.update'
  | 'products.delete'
  // Session 27 — granular product edit permissions
  | 'products.units.update'
  | 'products.sections.update'
  | 'products.modifiers.update'
  // Session 27c — product variants (parent/child)
  | 'products.variants.read'
  | 'products.variants.write'
  | 'categories.read'
  | 'categories.create'
  | 'categories.update'
  | 'categories.delete'
  | 'customers.read'
  | 'customers.create'
  | 'customers.update'
  | 'customers.delete'
  | 'customer_categories.read'
  | 'customer_categories.create'
  | 'customer_categories.update'
  | 'customer_categories.delete'
  | 'tables.read'
  | 'tables.create'
  | 'tables.update'
  | 'tables.delete'
  | 'combos.read'
  | 'combos.create'
  | 'combos.update'
  | 'combos.delete'
  | 'discount_templates.read'
  | 'discount_templates.create'
  | 'discount_templates.update'
  | 'discount_templates.delete'
  | 'suppliers.read'
  | 'suppliers.create'
  | 'suppliers.update'
  | 'suppliers.delete'
  | 'pos.sale.refund'
  | 'pos.sale.cancel_item'
  | 'users.create'
  | 'users.read'
  | 'users.update'
  | 'users.view_audit'
  | 'rbac.read'
  | 'rbac.update'
  | 'promotions.read'
  | 'promotions.create'
  | 'promotions.update'
  | 'promotions.delete'
  | 'loyalty.read'
  | 'loyalty.adjust'
  | 'inventory.read'
  | 'inventory.adjust'
  | 'inventory.receive'
  | 'inventory.waste'
  | 'inventory.transfer.create'
  | 'inventory.transfer.receive'
  | 'inventory.opname.create'
  | 'inventory.opname.finalize'
  | 'inventory.sections.update'
  // Session 15 / Phase 4.A — Batch production
  | 'inventory.production.create'
  | 'inventory.production.delete'
  // Session 15 / Phase 4.B — Production scheduling
  | 'inventory.production.schedule'
  | 'reports.read'
  | 'reports.export'
  | 'reports.sales.read'
  | 'reports.inventory.read'
  | 'reports.audit.read'
  | 'reports.financial.read'
  | 'expenses.read'
  | 'expenses.create'
  | 'expenses.update'
  | 'expenses.delete'
  | 'expenses.approve'
  | 'expenses.pay'
  | 'expenses.manage'
  // Session 13 / Phase 3.C
  | 'shift.open'
  | 'shift.close'
  | 'shift.cash_movement'
  | 'customers.b2b.update'
  | 'inventory.reservation.create'
  | 'inventory.reservation.release'
  // Session 13 / Phase 5.A — LAN port
  | 'print_queue.read'
  | 'print_queue.manage'
  | 'lan.devices.read'
  | 'lan.devices.manage'
  // Session 13 / Phase 5.B — Notifications pipeline
  | 'notifications.send'
  // Session 13 / Phase 5.C — Settings UI + holidays/templates
  | 'settings.read'
  | 'settings.update'
  | 'settings.holidays.manage'
  | 'settings.kiosk.manage'
  // Session 13 / Phase 6.C — Accounting mappings admin (module 10-012)
  | 'accounting.read'
  | 'accounting.mapping.update'
  // Session 26 / Wave 1.I — Comptable cockpit (S26 _026 seed)
  | 'accounting.coa.read'
  | 'accounting.coa.write'
  | 'accounting.gl.read'
  | 'accounting.tb.read'
  | 'accounting.je.create_manual'
  | 'accounting.period.close';

/**
 * Check whether a user has a single permission. Pure client-side lookup —
 * the source list is what the server returned at login time.
 *
 * @param userPermissions - The `permissions` array from {@link LoginResponse}.
 * @param required        - The permission to check.
 * @returns `true` if `required` is present in `userPermissions`.
 */
export function hasPermission(userPermissions: readonly string[], required: PermissionCode): boolean {
  return userPermissions.includes(required);
}

/**
 * OR-logic equivalent of {@link hasPermission}: returns `true` if the user
 * has *any* of the listed permissions. Use for UI gates that are unlocked by
 * multiple roles (e.g. void requires `pos.sale.void` OR `users.update`).
 *
 * @param userPermissions - The `permissions` array from {@link LoginResponse}.
 * @param required        - Permissions to check; any match returns `true`.
 */
export function hasAnyPermission(userPermissions: readonly string[], required: readonly PermissionCode[]): boolean {
  return required.some((r) => userPermissions.includes(r));
}
