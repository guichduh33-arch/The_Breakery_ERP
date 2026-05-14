// apps/backoffice/src/features/inventory-transfers/hooks/useTransferDetail.ts
//
// Session 12 — Phase 3 — fetch a single internal transfer + its items. Used
// by the detail page and the Receive modal.

import { useQuery } from '@tanstack/react-query';
import type { TransferStatus } from '@breakery/domain';
import { supabase } from '@/lib/supabase.js';

export interface TransferDetailHeader {
  id:                 string;
  transfer_number:    string;
  status:             TransferStatus;
  from_section_id:    string;
  to_section_id:      string;
  notes:              string | null;
  created_at:         string;
  transferred_at:     string | null;
  received_at:        string | null;
  created_by:         string;
  approved_by:        string | null;
  sections:    { code: string; name: string } | null;
  to_section:  { code: string; name: string } | null;
}

export interface TransferDetailItem {
  id:                  string;
  transfer_id:         string;
  product_id:          string;
  product_name:        string;
  product_sku:         string;
  quantity_requested:  number;
  quantity_received:   number | null;
  unit:                string;
  notes:               string | null;
}

export interface TransferDetail {
  transfer: TransferDetailHeader;
  items:    TransferDetailItem[];
}

export const transferDetailQueryKey = (id: string) =>
  ['internal-transfer', id] as const;

/** Narrow shape of the PostgREST `.single()` chain we exercise here. */
interface SingleChain {
  eq: (col: string, val: unknown) => {
    single: () => Promise<{ data: unknown; error: Error | null }>;
  };
}

/** Narrow shape of the PostgREST `.order()` chain we exercise here. */
interface OrderChain {
  eq: (col: string, val: unknown) => {
    order: (col: string) => Promise<{ data: unknown; error: Error | null }>;
  };
}

interface SelectFn<T> {
  select: (cols: string) => T;
}

export function useTransferDetail(id: string | undefined) {
  return useQuery<TransferDetail>({
    queryKey: transferDetailQueryKey(id ?? ''),
    enabled: typeof id === 'string' && id !== '',
    staleTime: 15_000,
    queryFn: async () => {
      if (id === undefined || id === '') {
        throw new Error('id_required');
      }

      // Header — untyped from() because `internal_transfers` is not in
      // types.generated yet. Go through the client object so `this` stays
      // bound to `supabase` (eslint unbound-method).
      const sbHeader = supabase as unknown as { from: (table: string) => SelectFn<SingleChain> };
      const headerRes = await sbHeader.from('internal_transfers')
        .select(
          'id, transfer_number, status, from_section_id, to_section_id, notes, created_at, transferred_at, received_at, created_by, approved_by, ' +
          'sections!internal_transfers_from_section_id_fkey(code, name), ' +
          'to_section:sections!internal_transfers_to_section_id_fkey(code, name)',
        )
        .eq('id', id)
        .single();
      if (headerRes.error !== null) throw headerRes.error;

      // Items — join products to expose name/sku without a second round trip.
      const sbItems = supabase as unknown as { from: (table: string) => SelectFn<OrderChain> };
      const itemsRes = await sbItems.from('transfer_items')
        .select('id, transfer_id, product_id, quantity_requested, quantity_received, unit, notes, products(name, sku)')
        .eq('transfer_id', id)
        .order('id');
      if (itemsRes.error !== null) throw itemsRes.error;

      const rawItems = (itemsRes.data as {
        id: string;
        transfer_id: string;
        product_id: string;
        quantity_requested: number;
        quantity_received: number | null;
        unit: string;
        notes: string | null;
        products: { name: string; sku: string } | null;
      }[] | null) ?? [];

      const items: TransferDetailItem[] = rawItems.map((it) => ({
        id:                 it.id,
        transfer_id:        it.transfer_id,
        product_id:         it.product_id,
        product_name:       it.products?.name ?? '(unknown)',
        product_sku:        it.products?.sku ?? '',
        quantity_requested: it.quantity_requested,
        quantity_received:  it.quantity_received,
        unit:               it.unit,
        notes:              it.notes,
      }));

      return {
        transfer: headerRes.data as TransferDetailHeader,
        items,
      };
    },
  });
}
