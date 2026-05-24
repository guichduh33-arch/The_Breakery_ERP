import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface ApprovalStep {
  role_codes: string[];
  label: string;
}

export interface ExpenseThresholdRow {
  id: string;
  category_id: string | null;
  category_name?: string | null;
  amount_min: number;
  amount_max: number;
  steps: ApprovalStep[];
  created_at: string;
  updated_at: string;
}

export function useExpenseThresholds() {
  return useQuery({
    queryKey: ['expense_thresholds'],
    queryFn: async (): Promise<ExpenseThresholdRow[]> => {
      const { data, error } = await supabase
        .from('expense_approval_thresholds')
        .select('id, category_id, amount_min, amount_max, steps, created_at, updated_at, expense_categories(name)')
        .order('category_id', { nullsFirst: false })
        .order('amount_min', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        category_name: (r as { expense_categories?: { name: string } | null }).expense_categories?.name ?? null,
        steps: r.steps as unknown as ApprovalStep[],
      })) as ExpenseThresholdRow[];
    },
  });
}
