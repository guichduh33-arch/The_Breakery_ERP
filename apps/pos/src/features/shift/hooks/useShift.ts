// apps/pos/src/features/shift/hooks/useShift.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore, type ActiveShift } from '@/stores/shiftStore';

export function useCurrentShift() {
  const userId = useAuthStore((s) => s.user?.id);
  const setCurrent = useShiftStore((s) => s.setCurrent);

  return useQuery({
    queryKey: ['pos_sessions', 'current', userId],
    enabled: !!userId,
    queryFn: async (): Promise<ActiveShift | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('pos_sessions')
        .select('id, opened_at, opening_cash')
        .eq('opened_by', userId)
        .eq('status', 'open')
        .maybeSingle();
      if (error) throw error;
      setCurrent(data);
      return data;
    },
  });
}

export function useOpenShift() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  const setCurrent = useShiftStore((s) => s.setCurrent);

  return useMutation({
    mutationFn: async (input: { opening_cash: number; opening_notes?: string }) => {
      if (!userId) throw new Error('not_authenticated');
      const { data, error } = await supabase
        .from('pos_sessions')
        .insert({ opened_by: userId, opening_cash: input.opening_cash, opening_notes: input.opening_notes ?? null })
        .select('id, opened_at, opening_cash')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (shift) => {
      setCurrent(shift);
      void queryClient.invalidateQueries({ queryKey: ['pos_sessions'] });
    },
  });
}
