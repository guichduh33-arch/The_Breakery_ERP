// apps/backoffice/src/features/accounting/hooks/useArAging.ts
// Session 26c / Wave 2 — SELECT view_ar_aging.
// View shipped by S24 _012 ; one row per (customer × bucket).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ArAgingRow {
  customer_id:       string;
  b2b_company_name:  string | null;
  customer_name:     string | null;
  bucket:            'current' | '31-60' | '61-90' | '90+' | string;
  invoice_count:     number;
  total_outstanding: number;
  min_age_days:      number;
  max_age_days:      number;
}

export const AR_AGING_KEY = ['accounting', 'ar-aging'] as const;

export function useArAging() {
  return useQuery<ArAgingRow[]>({
    queryKey: AR_AGING_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('view_ar_aging')
        .select('customer_id, b2b_company_name, customer_name, bucket, invoice_count, total_outstanding, min_age_days, max_age_days')
        .order('b2b_company_name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ArAgingRow[];
    },
  });
}
