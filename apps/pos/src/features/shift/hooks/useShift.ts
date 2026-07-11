// apps/pos/src/features/shift/hooks/useShift.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { emitPosEvent } from '@/features/audit/emitPosEvent';
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
    mutationFn: async (input: {
      opening_cash: number;
      opening_notes?: string;
      terminal_id?: string | null;
      /** S67 (12 D2.3) — grille de coupures d'ouverture (flag config ON). */
      opening_denominations?: Record<string, number> | null;
    }) => {
      if (!userId) throw new Error('not_authenticated');
      const { data, error } = await supabase
        .from('pos_sessions')
        .insert({
          opened_by:     userId,
          opening_cash:  input.opening_cash,
          opening_notes: input.opening_notes ?? null,
          terminal_id:   input.terminal_id ?? null,
          opening_denominations: input.opening_denominations ?? null,
        })
        .select('id, opened_at, opening_cash')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (shift) => {
      setCurrent(shift);
      // S72 audit — journal the drawer opening (declared opening float is a
      // fraud signal). The pos_sessions row stays authoritative; this is the
      // immutable journal entry mirroring it.
      emitPosEvent('session_opened', {
        session_id: shift.id,
        amount: shift.opening_cash,
      });
      void queryClient.invalidateQueries({ queryKey: ['pos_sessions'] });
    },
  });
}
