// apps/pos/src/features/order-history/hooks/useOrderRetryStatus.ts
//
// Session 13 / Phase 4.A — detect orders where status='paid' but the sale
// journal entry trigger failed to fire (race condition: account mapping was
// missing at completion time, fiscal period flipped mid-tx, trigger raised).
//
// Detection logic: an order with `status='paid'` MUST have a corresponding
// row in `journal_entries` with `reference_id = order.id` and
// `reference_type = 'sale'`. If zero rows, the order is "JE-missing" and the
// OrderRetryBanner surfaces a one-click retry.
//
// We rely on the FK relationship `journal_entries.reference_id -> orders.id`
// (free-form text but indexed); a left join + count is performed via two
// queries to avoid PostgREST embed nuance.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface OrderRetryStatus {
  /** True when status='paid' AND no sale journal_entries row exists. */
  needsRetry: boolean;
  /**
   * Raw count of journal_entries rows referencing this order. >=1 means the
   * trigger fired successfully ; the banner is hidden.
   */
  journalEntryCount: number;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
  count: number | null;
}
interface SelectBuilder {
  eq: (col: string, val: unknown) => SelectBuilder;
  then: <R>(fn: (qr: QueryResult<unknown>) => R) => Promise<R>;
}
interface LooseFromBuilder {
  select: (cols: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) => SelectBuilder;
}
interface LooseSupabase {
  from: (table: string) => LooseFromBuilder;
}
const sb = supabase as unknown as LooseSupabase;

/**
 * Probe for journal-entry presence on a paid order. Returns immediately with
 * `needsRetry=false` when `orderId` is null OR when the caller has already
 * passed a non-`paid` status (no point probing voided / draft orders).
 *
 * @param orderId - The order being inspected (typically the selected row in
 *                  `OrderHistoryPanel`).
 * @param status  - The order's current status, forwarded so we skip the
 *                  probe entirely for non-paid orders.
 */
export function useOrderRetryStatus(
  orderId: string | null,
  status: 'paid' | 'voided' | 'draft' | null,
) {
  return useQuery<OrderRetryStatus>({
    queryKey: ['order-retry-status', orderId],
    queryFn: async (): Promise<OrderRetryStatus> => {
      if (!orderId) return { needsRetry: false, journalEntryCount: 0 };
      // Count-only query — no row data needed, just the integer.
      const builder = sb
        .from('journal_entries')
        .select('id', { count: 'exact', head: true })
        .eq('reference_id', orderId)
        .eq('reference_type', 'sale');
      const result = await (builder as unknown as Promise<QueryResult<unknown>>);
      if (result.error) throw new Error(result.error.message);
      const count = result.count ?? 0;
      return {
        needsRetry: count === 0,
        journalEntryCount: count,
      };
    },
    // Only run when we have a paid order to inspect. Voided / draft orders
    // don't expect a JE and shouldn't trigger the banner.
    enabled: Boolean(orderId) && status === 'paid',
    // Trigger fires synchronously inside the order RPC, so a stale-time of 30s
    // is safe ; banner manual-refetches on retry success.
    staleTime: 30_000,
  });
}
