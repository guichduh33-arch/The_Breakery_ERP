// apps/backoffice/src/features/purchasing/hooks/usePurchaseOrdersList.ts
//
// Session 13 — Phase 3.A — paginated list of purchase_orders with supplier
// name embed.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type POStatus = 'draft' | 'pending' | 'partial' | 'received' | 'cancelled';
export type PaymentTerms = 'cash' | 'credit';

export type PurchaseOrderRow =
  Database['public']['Tables']['purchase_orders']['Row'];

export interface PurchaseOrderListRow extends PurchaseOrderRow {
  /** Embedded supplier row from PostgREST. */
  suppliers: { code: string; name: string } | null;
}

export interface PurchaseOrdersFilters {
  status?:      POStatus;
  supplierId?:  string;
  fromDate?:    string;   // ISO date
  toDate?:      string;   // ISO date
  search?:      string;   // matches po_number ilike
  limit?:       number;
  offset?:      number;
}

export const PURCHASE_ORDERS_QUERY_KEY = ['purchase-orders-bo'] as const;

const DEFAULT_LIMIT = 50;

export function usePurchaseOrdersList(filters: PurchaseOrdersFilters = {}) {
  const limit  = filters.limit  ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;

  return useQuery<PurchaseOrderListRow[]>({
    queryKey: [...PURCHASE_ORDERS_QUERY_KEY, { ...filters, limit, offset }] as const,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('purchase_orders')
        .select(
          'id, po_number, supplier_id, status, payment_terms, subtotal, vat_amount, ' +
          'total_amount, order_date, expected_date, received_date, notes, cancel_reason, ' +
          'import_reference, is_historical_import, ' +
          'metadata, idempotency_key, created_by, received_by, cancelled_by, cancelled_at, ' +
          'created_at, updated_at, deleted_at, ' +
          'suppliers(code, name)'
        )
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (filters.status !== undefined)     q = q.eq('status', filters.status);
      if (filters.supplierId !== undefined) q = q.eq('supplier_id', filters.supplierId);
      if (filters.fromDate !== undefined)   q = q.gte('order_date', filters.fromDate);
      if (filters.toDate !== undefined)     q = q.lte('order_date', filters.toDate);
      if (filters.search !== undefined && filters.search.trim() !== '') {
        const term = filters.search.trim().replace(/[%_]/g, '\\$&');
        q = q.ilike('po_number', `%${term}%`);
      }

      const { data, error } = await q.range(offset, offset + limit - 1);
      if (error !== null) throw error;
      return (data as unknown as PurchaseOrderListRow[]) ?? [];
    },
  });
}
