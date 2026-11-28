// apps/backoffice/src/features/purchasing/hooks/usePurchaseOrdersList.ts
//
// Liste paginée des bons de commande, nom du fournisseur et statut de paiement
// embarqués.
//
// Harmonisation 2026-11-28 :
//   · pagination SERVEUR avec compteur exact — la liste s'arrêtait aux 50 bons
//     les plus récents, sans pied ni avertissement, et les compteurs ne
//     comptaient que ces 50 ;
//   · filtre de PAIEMENT via les champs calculés `po_payment_status` /
//     `po_paid_amount` (PostgREST), pour filtrer côté serveur sans casser la
//     pagination ;
//   · filtre de dates sur le champ choisi : jour de commande (défaut), livraison
//     prévue ou réception.

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type POStatus = 'draft' | 'pending' | 'partial' | 'received' | 'cancelled';
export type PaymentTerms = 'cash' | 'credit';
export type PoPaymentFilter = 'unpaid' | 'partial' | 'paid';
/** Le champ de date sur lequel porte la plage. */
export type PoDateField = 'order_date' | 'expected_date' | 'received_date';

export type PurchaseOrderRow =
  Database['public']['Tables']['purchase_orders']['Row'];

export interface PurchaseOrderListRow extends PurchaseOrderRow {
  /** Embedded supplier row from PostgREST. */
  suppliers: { code: string; name: string } | null;
  /** Champ calculé : somme du grand livre des paiements (contre-passations comprises). */
  po_paid_amount: number | string | null;
  /** Champ calculé : none | imported | unpaid | partial | paid. */
  po_payment_status: string | null;
}

export interface PurchaseOrdersFilters {
  status?:        POStatus;
  supplierId?:    string;
  paymentStatus?: PoPaymentFilter;
  dateField?:     PoDateField;
  fromDate?:      string;   // ISO date, inclusive
  toDate?:        string;   // ISO date, inclusive
  search?:        string;   // matches po_number ilike
  limit?:         number;
  offset?:        number;
}

export interface PurchaseOrdersPage {
  rows:  PurchaseOrderListRow[];
  total: number;
}

export const PURCHASE_ORDERS_QUERY_KEY = ['purchase-orders-bo'] as const;

const DEFAULT_LIMIT = 50;

const LIST_COLUMNS =
  'id, po_number, supplier_id, status, payment_terms, subtotal, vat_amount, ' +
  'total_amount, order_date, expected_date, received_date, notes, cancel_reason, ' +
  'import_reference, is_historical_import, ' +
  'metadata, idempotency_key, created_by, received_by, cancelled_by, cancelled_at, ' +
  'created_at, updated_at, deleted_at, ' +
  'po_paid_amount, po_payment_status, ' +
  'suppliers(code, name)';

/**
 * La part du constructeur PostgREST dont les filtres ont besoin. Un type
 * structurel plutôt que le générique de supabase-js : le champ calculé
 * `po_payment_status` n'est pas une colonne de la table, et le générique
 * refuse de le filtrer.
 */
interface FilterChain {
  is(column: string, value: null): FilterChain;
  eq(column: string, value: string): FilterChain;
  gte(column: string, value: string): FilterChain;
  lte(column: string, value: string): FilterChain;
  ilike(column: string, pattern: string): FilterChain;
}

/** Les filtres communs à la liste et aux compteurs. Exporté pour les tests. */
export function applyPoFilters<Q>(q: Q, filters: PurchaseOrdersFilters): Q {
  let r = (q as unknown as FilterChain).is('deleted_at', null);
  if (filters.status !== undefined)        r = r.eq('status', filters.status);
  if (filters.supplierId !== undefined)    r = r.eq('supplier_id', filters.supplierId);
  if (filters.paymentStatus !== undefined) r = r.eq('po_payment_status', filters.paymentStatus);
  const field = filters.dateField ?? 'order_date';
  if (filters.fromDate !== undefined)      r = r.gte(field, filters.fromDate);
  if (filters.toDate !== undefined)        r = r.lte(field, filters.toDate);
  if (filters.search !== undefined && filters.search.trim() !== '') {
    const term = filters.search.trim().replace(/[%_]/g, '\\$&');
    r = r.ilike('po_number', `%${term}%`);
  }
  return r as unknown as Q;
}

export function usePurchaseOrdersList(filters: PurchaseOrdersFilters = {}) {
  const limit  = filters.limit  ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;

  return useQuery<PurchaseOrdersPage>({
    queryKey: [...PURCHASE_ORDERS_QUERY_KEY, { ...filters, limit, offset }] as const,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const base = supabase.from('purchase_orders').select(LIST_COLUMNS, { count: 'exact' });
      const { data, error, count } = await applyPoFilters(base, filters)
        // Le jour de commande d'abord, la saisie ensuite : un bon saisi en
        // retard se range à la date où il a été passé, pas à celle de sa saisie.
        .order('order_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error !== null) throw error;
      return {
        rows:  (data as unknown as PurchaseOrderListRow[]) ?? [],
        total: count ?? 0,
      };
    },
  });
}

export type PoCounterKey = 'all' | 'pending' | 'partial' | 'received' | 'cancelled';

/**
 * Compteurs par statut de réception — des COMPTES serveur (HEAD), plus le
 * décompte des 50 lignes chargées. Ils suivent tous les filtres sauf le statut.
 */
export function usePurchaseOrderCounts(filters: Omit<PurchaseOrdersFilters, 'status' | 'limit' | 'offset'>) {
  return useQuery<Record<PoCounterKey, number>>({
    queryKey: [...PURCHASE_ORDERS_QUERY_KEY, 'counts', filters] as const,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const keys: PoCounterKey[] = ['all', 'pending', 'partial', 'received', 'cancelled'];
      const results = await Promise.all(keys.map(async (k) => {
        const base = supabase.from('purchase_orders').select('id', { count: 'exact', head: true });
        const { count, error } = await applyPoFilters(base, k === 'all' ? filters : { ...filters, status: k });
        if (error !== null) throw error;
        return [k, count ?? 0] as const;
      }));
      return Object.fromEntries(results) as Record<PoCounterKey, number>;
    },
  });
}
