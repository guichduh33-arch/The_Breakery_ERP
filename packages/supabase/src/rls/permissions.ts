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
  | 'users.create'
  | 'users.update'
  | 'users.view_audit';

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
