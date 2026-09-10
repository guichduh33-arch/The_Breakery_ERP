import type { CartItem, ComboComponent, OrderType, ProductType, SelectedModifiers } from '@breakery/domain';

export interface OrderItemSnapshot {
  id: string;
  client_line_id?: string | null;
  product_id: string;
  name_snapshot?: string;
  name?: string;
  unit_price: number;
  quantity: number;
  line_total?: number;
  modifiers: unknown;
  product_type?: string | null;
  combo_components?: ComboComponent[] | null;
  discount_amount?: number;
  discount_reason?: string | null;
  is_cancelled?: boolean;
  is_locked: boolean;
  kitchen_status: string | null;
}

export interface OrderSnapshot {
  order_id: string;
  order_number?: string;
  order_type: string;
  created_via?: string;
  customerId: string | null;
  tableNumber: string | null;
  notes: string | null;
  items: OrderItemSnapshot[];
}

export function snapshotItem(row: OrderItemSnapshot, localId?: string): CartItem {
  const discount = row.discount_amount ?? 0;
  return {
    id: localId ?? row.client_line_id ?? row.id,
    server_id: row.id,
    product_id: row.product_id,
    name: row.name_snapshot ?? row.name ?? '',
    unit_price: row.unit_price,
    quantity: row.quantity,
    modifiers: (row.modifiers ?? []) as SelectedModifiers,
    ...(row.line_total !== undefined ? { server_line_total: row.line_total + discount } : {}),
    ...(row.product_type ? { product_type: row.product_type as ProductType } : {}),
    ...(row.combo_components ? { combo_components: row.combo_components } : {}),
    ...(row.is_cancelled ? { is_cancelled: true } : {}),
    ...(discount > 0 ? { discount: {
      type: 'fixed_amount' as const, value: discount, amount: discount,
      reason: row.discount_reason ?? 'Recorded discount',
    } } : {}),
  };
}

/** Réconciliation des faits serveur sans remplacer les brouillons locaux. */
export function reconcileOrderItems(local: CartItem[], rows: OrderItemSnapshot[]): CartItem[] {
  const remaining = new Map(rows.map((row) => [row.id, row]));
  const byClient = new Map(rows.filter((r) => r.client_line_id).map((r) => [r.client_line_id, r]));
  const items = local.map((item) => {
    const row = remaining.get(item.server_id ?? item.id) ?? byClient.get(item.id);
    if (!row) return item.server_id ? { ...item, is_cancelled: true } : item;
    remaining.delete(row.id);
    return snapshotItem(row, item.id);
  });
  return [...items, ...[...remaining.values()].map((row) => snapshotItem(row))];
}

export function snapshotCart(snapshot: OrderSnapshot) {
  return {
    items: snapshot.items.map((row) => snapshotItem(row)),
    order_type: snapshot.order_type as OrderType,
    ...(snapshot.customerId ? { customerId: snapshot.customerId } : {}),
    ...(snapshot.tableNumber ? { tableNumber: snapshot.tableNumber } : {}),
  };
}
