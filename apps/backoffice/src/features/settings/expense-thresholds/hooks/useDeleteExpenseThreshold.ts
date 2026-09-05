import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export function useDeleteExpenseThreshold() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (threshold_id: string): Promise<boolean> => {
      const { data, error } = await supabase.rpc('delete_expense_threshold_v2', {
        p_threshold_id: threshold_id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['expense_thresholds'] });
    },
  });
}
