// apps/backoffice/src/features/reports/utils/salesFilters.ts
//
// S3-22 — les filtres de commande des rapports de vente, tels que les lisent
// `get_sales_by_product` et `get_product_sales_lines` (argument `p_filters`).
// Les deux RPC appliquent la MÊME portée : c'est ce qui permet aux lignes du
// tiroir de refermer le total affiché par le classement.
// Les familles `get_sales_by_category`, `get_sales_by_staff`,
// `get_sales_by_origin` et `get_sales_by_customer` lisent le même argument,
// avec les mêmes prédicats.
//
// Les valeurs d'enum sont typées sur Postgres (types régénérés) : aucune
// valeur n'est recopiée ici.

import type { Json } from '@breakery/supabase';
import type { OrderType, PaymentMethod } from '@/features/orders/statusMeta.js';

export interface SalesOrderFilters {
  order_type?:     OrderType;
  payment_method?: PaymentMethod;
  /** Égalité stricte côté serveur. */
  table_number?:   string;
}

/** L'objet `p_filters` sans clé vide, ou `null` si aucun filtre n'est actif. */
export function toRpcFilters(f: SalesOrderFilters | undefined): Record<string, Json> | null {
  if (f === undefined) return null;
  const out: Record<string, Json> = {};
  if (f.order_type)     out.order_type = f.order_type;
  if (f.payment_method) out.payment_method = f.payment_method;
  const table = f.table_number?.trim() ?? '';
  if (table !== '')     out.table_number = table;
  return Object.keys(out).length > 0 ? out : null;
}

/** Fragment de clé react-query : un filtre différent = un cache différent. */
export function salesFiltersKey(f: SalesOrderFilters | undefined): readonly (string | null)[] {
  const table = f?.table_number?.trim() ?? '';
  return [f?.order_type ?? null, f?.payment_method ?? null, table !== '' ? table : null];
}
