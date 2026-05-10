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
  | 'products.delete'
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
  | 'users.update'
  | 'users.view_audit'
  | 'promotions.read'
  | 'promotions.create'
  | 'promotions.update'
  | 'promotions.delete'
  | 'loyalty.read'
  | 'loyalty.adjust';

export function hasPermission(userPermissions: readonly string[], required: PermissionCode): boolean {
  return userPermissions.includes(required);
}

export function hasAnyPermission(userPermissions: readonly string[], required: readonly PermissionCode[]): boolean {
  return required.some((r) => userPermissions.includes(r));
}
