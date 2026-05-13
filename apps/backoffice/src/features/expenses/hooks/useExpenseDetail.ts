// apps/backoffice/src/features/expenses/hooks/useExpenseDetail.ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { ExpenseRow } from './useExpensesList.js';

export function useExpenseDetail(id: string | undefined) {
  return useQuery<ExpenseRow | null>({
    queryKey: ['expense-detail', id] as const,
    enabled: id !== undefined && id !== '',
    queryFn: async () => {
      if (id === undefined || id === '') return null;
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
