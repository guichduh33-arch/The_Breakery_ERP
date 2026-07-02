// apps/backoffice/src/features/btob/hooks/useB2bInvoices.ts
// Session 56 — DEV-S52-03 : per-invoice list from view_b2b_invoices (S52 _070).
// outstanding = invoice_total − Σ b2b_payment_allocations.amount_applied.
// Ordered oldest-first to match the server-side FIFO allocation order.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bInvoiceRow {
  invoice_id:       string;
  order_number:     string;
  customer_id:      string;
  b2b_company_name: string | null;
  customer_name:    string | null;
  invoice_total:    number;
  invoice_date:     string;
  paid_at:          string | null;
  order_status:     string;
  age_days:         number;
  is_unpaid:        boolean;
  amount_paid:      number;
  outstanding:      number;
}

export const B2B_INVOICES_QUERY_KEY = ['b2b-invoices'] as const;

export function useB2bInvoices(customerId?: string, unpaidOnly = false, enabled = true) {
  return useQuery<B2bInvoiceRow[]>({
    queryKey: [...B2B_INVOICES_QUERY_KEY, customerId ?? 'all', unpaidOnly],
    staleTime: 15_000,
    enabled,
    queryFn: async () => {
      let q = supabase
        .from('view_b2b_invoices')
        .select('invoice_id, order_number, customer_id, b2b_company_name, customer_name, invoice_total, invoice_date, paid_at, order_status, age_days, is_unpaid, amount_paid, outstanding')
        .order('invoice_date', { ascending: true })
        .limit(500);
      if (customerId !== undefined && customerId !== '') q = q.eq('customer_id', customerId);
      if (unpaidOnly) q = q.gt('outstanding', 0);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as B2bInvoiceRow[];
    },
  });
}
