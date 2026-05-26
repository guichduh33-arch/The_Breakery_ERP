/**
 * Session 31 — Reports Drill-Down navigation transverse.
 *
 * Pure helper mapping (entity, id, filter?) → URL string or null.
 * Used by <DrilldownLink> component to build navigation targets from report cells.
 *
 * Returns `null` when the combo has no viable target (empty id, unknown entity).
 * Callers render plain text instead of <Link> in that case.
 */

export type DrilldownEntity =
  | 'product'
  | 'category'
  | 'user'
  | 'customer'
  | 'order'
  | 'recipe'
  | 'account'
  | 'supplier'
  | 'expense'
  | 'purchase_order';

export interface DrilldownFilter {
  date_from?: string;
  date_to?: string;
  category_id?: string;
  payment_method?: string;
  movement_type?: string;
  created_by?: string;
  hour_from?: number;
  hour_to?: number;
  [key: string]: string | number | undefined;
}

const DETAIL_ROUTES: Partial<Record<DrilldownEntity, string>> = {
  product: '/backoffice/products/',
  user: '/backoffice/users/',
  supplier: '/backoffice/suppliers/',
  expense: '/backoffice/expenses/',
  purchase_order: '/backoffice/purchasing/purchase-orders/',
  customer: '/backoffice/customers/',
  order: '/backoffice/orders/',
  recipe: '/backoffice/inventory/recipes/',
};

const LIST_FILTERED: Partial<Record<DrilldownEntity, (id: string) => string>> = {
  category: (id) => `/backoffice/products?category_id=${encodeURIComponent(id)}`,
  account: (id) =>
    `/backoffice/accounting/general-ledger?account_id=${encodeURIComponent(id)}`,
};

function appendFilter(base: string, filter?: DrilldownFilter): string {
  if (!filter) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  if (!qs) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${qs}`;
}

export function buildDrilldownUrl(
  entity: DrilldownEntity,
  id: string,
  filter?: DrilldownFilter,
): string | null {
  if (!id) return null;
  const detailPrefix = DETAIL_ROUTES[entity];
  if (detailPrefix) {
    return appendFilter(`${detailPrefix}${encodeURIComponent(id)}`, filter);
  }
  const listFn = LIST_FILTERED[entity];
  if (listFn) {
    return appendFilter(listFn(id), filter);
  }
  return null;
}
