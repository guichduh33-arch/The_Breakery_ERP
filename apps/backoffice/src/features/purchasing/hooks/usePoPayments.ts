// apps/backoffice/src/features/purchasing/hooks/usePoPayments.ts
//
// Session 46 — R3: reads the append-only purchase_payments ledger for a PO.
// Payment status is derived (unpaid/partial/paid) and INDEPENDENT from goods
// reception — a credit PO can be fully received yet unpaid, and vice-versa.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface PoPaymentRow {
  id:         string;
  amount:     number;
  method:     string;
  paid_at:    string;
  reference:  string | null;
  paid_by:    string | null;
}

export type PoPaymentStatus = 'unpaid' | 'partial' | 'paid';

export interface PoPaymentsResult {
  payments:  PoPaymentRow[];
  totalPaid: number;
}

export const PO_PAYMENTS_QUERY_KEY = ['po-payments'] as const;

export function usePoPayments(poId: string | undefined) {
  return useQuery<PoPaymentsResult>({
    queryKey: [...PO_PAYMENTS_QUERY_KEY, poId] as const,
    enabled:  poId !== undefined && poId !== '',
    staleTime: 15_000,
    queryFn: async () => {
      if (poId === undefined || poId === '') return { payments: [], totalPaid: 0 };
      const { data, error } = await supabase
        .from('purchase_payments')
        .select('id, amount, method, paid_at, reference, paid_by')
        .eq('purchase_order_id', poId)
        .order('paid_at', { ascending: true });
      if (error !== null) throw error;
      const payments = ((data ?? []) as unknown as PoPaymentRow[]).map((p) => ({
        ...p,
        amount: Number(p.amount),
      }));
      const totalPaid = payments.reduce((acc, p) => acc + p.amount, 0);
      return { payments, totalPaid };
    },
  });
}

/** Derive the payment status from amounts (independent of reception). */
export function derivePaymentStatus(totalPaid: number, totalDue: number): PoPaymentStatus {
  if (totalPaid <= 0) return 'unpaid';
  if (totalPaid + 0.005 >= totalDue) return 'paid';
  return 'partial';
}
