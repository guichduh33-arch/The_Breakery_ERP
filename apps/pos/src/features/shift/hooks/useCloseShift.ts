// apps/pos/src/features/shift/hooks/useCloseShift.ts
// Session 13 / Phase 3.C — React Query mutation wrapper around close_shift_v1.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';

export interface CloseShiftInput {
  session_id:    string;
  counted_cash:  number;
  notes?:        string;
  idempotency_key?: string;
}

export interface CloseShiftResult {
  session_id:       string;
  status:           'closed';
  opening_cash:     number;
  cash_sales:       number;
  cash_in_total:    number;
  cash_out_total:   number;
  counted_cash:     number;
  expected_cash:    number;
  variance:         number;
  journal_entry_id: string | null;
  idempotent_replay: boolean;
}

export function useCloseShift() {
  const qc = useQueryClient();
  const clearShift = useShiftStore((s) => s.clear);

  return useMutation({
    mutationFn: async (input: CloseShiftInput): Promise<CloseShiftResult> => {
      const args: {
        p_session_id:      string;
        p_counted_cash:    number;
        p_notes?:          string;
        p_idempotency_key?: string;
      } = {
        p_session_id:   input.session_id,
        p_counted_cash: input.counted_cash,
      };
      if (input.notes !== undefined)            args.p_notes = input.notes;
      if (input.idempotency_key !== undefined)  args.p_idempotency_key = input.idempotency_key;
      const { data, error } = await supabase.rpc('close_shift_v1', args);
      if (error) throw new Error(error.message);
      return data as unknown as CloseShiftResult;
    },
    onSuccess: () => {
      clearShift();
      void qc.invalidateQueries({ queryKey: ['pos_sessions'] });
    },
  });
}
