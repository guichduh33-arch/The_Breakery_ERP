/**
 * Session 31 — Reports Drill-Down navigation transverse.
 * Session 32 — Extended with `order_list` filter-only entity.
 *
 * Pure helper mapping (entity, id, filter?) → URL string or null.
 * Used by <DrilldownLink> component to build navigation targets from report cells.
 *
 * Returns `null` when the combo has no viable target (empty id for detail/list-with-id
 * entities, unknown entity). Callers render plain text instead of <Link> in that case.
 *
 * `order_list` is a filter-only entity: pass `id=''` and the URL is built from `filter`.
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
  | 'purchase_order'
  | 'order_list';

export interface DrilldownFilter {
  // S31 legacy filter keys
  date_from?:      string;
  date_to?:        string;
  category_id?:    string;
  payment_method?: string;
  movement_type?:  string;
  created_by?:     string;
  hour_from?:      number;
  hour_to?:        number;
  // S32 — order_list filter axes
  start?:          string;
  end?:            string;
  status?:         string;
  order_type?:     string;
  customer_id?:    string;
  served_by?:      string;
  total_min?:      number;
  total_max?:      number;
  customer_type?:  'retail' | 'b2b';
  refund_status?:  'none' | 'partial' | 'full';
  hour?:           number;
  has_modifiers?:  boolean;
  [key: string]:   string | number | boolean | undefined;
}

const DETAIL_ROUTES: Partial<Record<DrilldownEntity, string>> = {
  product:        '/backoffice/products/',
  user:           '/backoffice/users/',
  supplier:       '/backoffice/suppliers/',
  expense:        '/backoffice/expenses/',
  purchase_order: '/backoffice/purchasing/purchase-orders/',
  customer:       '/backoffice/customers/',
  order:          '/backoffice/orders/',
  recipe:         '/backoffice/inventory/recipes/',
};

const LIST_FILTERED: Partial<Record<DrilldownEntity, (id: string) => string>> = {
  category: (id) => `/backoffice/products?category_id=${encodeURIComponent(id)}`,
  account: (id) =>
    `/backoffice/accounting/general-ledger?account_id=${encodeURIComponent(id)}`,
};

// S32 — filter-only entities: URL built from filter alone, id ignored.
const LIST_FILTER_ONLY: Partial<Record<DrilldownEntity, string>> = {
  order_list: '/backoffice/orders',
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
  // Filter-only entities: id is unused, URL comes from base + filter.
  const filterOnly = LIST_FILTER_ONLY[entity];
  if (filterOnly) {
    return appendFilter(filterOnly, filter);
  }
  // All other entities require a non-empty id.
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
