import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { ApprovalStep } from './useExpenseThresholds';

export interface SetThresholdInput {
  threshold_id?: string | null;
  category_id?: string | null;
  amount_min: number;
  amount_max: number;
  steps: ApprovalStep[];
}

export function useSetExpenseThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetThresholdInput): Promise<string> => {
      const args = {
        p_amount_min: input.amount_min,
        p_amount_max: input.amount_max,
        p_steps:      input.steps as unknown as never,
        ...(input.threshold_id != null && { p_threshold_id: input.threshold_id }),
        ...(input.category_id  != null && { p_category_id:  input.category_id }),
      };
      const { data, error } = await supabase.rpc('set_expense_threshold_v1', args as never);
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense_thresholds'] });
    },
  });
}
