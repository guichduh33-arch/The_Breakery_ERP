// apps/backoffice/src/features/btob/hooks/useB2bPaymentsReceived.ts
//
// Session 24 / Phase 2.A.4 — list rows from the b2b_payments ledger (S24
// migration _010). Joined with `customers` for display name. Period filter
// drives a paid_at lower bound on the server.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type B2bPaymentsPeriod = 'all' | '7d' | '30d' | 'mtd';

export interface B2bPaymentReceivedRow {
  id:             string;
  payment_number: string;
  customer_id:    string;
  customer_name:  string | null;
  company_name:   string | null;
  amount:         number;
  method:         string;
  reference:      string | null;
  paid_at:        string;
  notes:          string | null;
}

export const B2B_PAYMENTS_RECEIVED_QUERY_KEY = ['b2b-payments-received'] as const;

function periodLowerBound(period: B2bPaymentsPeriod): string | null {
  const now = new Date();
  switch (period) {
    case '7d': {
      const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString();
    }
    case '30d': {
      const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString();
    }
    case 'mtd': {
      const d = new Date(now.getFullYear(), now.getMonth(), 1); return d.toISOString();
    }
    default: return null;
  }
}

export function useB2bPaymentsReceived(period: B2bPaymentsPeriod = 'all') {
  return useQuery<B2bPaymentReceivedRow[]>({
    queryKey: [...B2B_PAYMENTS_RECEIVED_QUERY_KEY, period],
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from('b2b_payments')
        .select('id, payment_number, customer_id, amount, method, reference, paid_at, notes, customers!inner(name, b2b_company_name)')
        .order('paid_at', { ascending: false })
        .limit(500);

      const lb = periodLowerBound(period);
      if (lb !== null) q = q.gte('paid_at', lb);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as unknown as Array<{
        id: string; payment_number: string; customer_id: string;
        amount: number; method: string; reference: string | null;
        paid_at: string; notes: string | null;
        customers: { name: string | null; b2b_company_name: string | null } | null;
      }>;
      return rows.map((r) => ({
        id:             r.id,
        payment_number: r.payment_number,
        customer_id:    r.customer_id,
        customer_name:  r.customers?.name ?? null,
        company_name:   r.customers?.b2b_company_name ?? null,
        amount:         Number(r.amount),
        method:         r.method,
        reference:      r.reference,
        paid_at:        r.paid_at,
        notes:          r.notes,
      }));
    },
  });
}
