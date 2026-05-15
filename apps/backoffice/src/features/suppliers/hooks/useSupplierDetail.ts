// apps/backoffice/src/features/suppliers/hooks/useSupplierDetail.ts
//
// Session 14 — Phase 5.A — Read-only supplier detail loader.
// Powers the SupplierDetailPage header card (identity, contact, payment terms).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { SupplierRow } from './useSuppliersList.js';

export const SUPPLIER_DETAIL_QUERY_KEY = ['supplier-detail'] as const;

export function useSupplierDetail(id: string | undefined) {
  return useQuery<SupplierRow | null>({
    queryKey: [...SUPPLIER_DETAIL_QUERY_KEY, id ?? ''] as const,
    enabled: id !== undefined && id !== '',
    queryFn: async () => {
      if (id === undefined || id === '') return null;
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
