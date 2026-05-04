// Helper côté client : vérifie une permission contre la liste retournée
// par auth-verify-pin (cachée dans authStore). Pas de roundtrip serveur.

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

export function hasPermission(userPermissions: readonly string[], required: PermissionCode): boolean {
  return userPermissions.includes(required);
}

export function hasAnyPermission(userPermissions: readonly string[], required: readonly PermissionCode[]): boolean {
  return required.some((r) => userPermissions.includes(r));
}
