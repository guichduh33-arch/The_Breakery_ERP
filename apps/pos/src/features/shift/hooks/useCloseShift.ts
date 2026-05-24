// apps/pos/src/features/shift/hooks/useCloseShift.ts
// Session 13 / Phase 3.C — React Query mutation wrapper around close_shift_v1.
// Session 29 / Wave 1.B — bumped to close_shift_v2 (adds z_report draft creation).
// Session 29 / Wave 6.D — after successful close_shift_v2, chain EF generate-zreport-pdf
// (non-blocking: PDF generation failure does NOT roll back the shift close; user can
// retry from the Z-Reports page in BO).

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
  zreport_id:       string | null;
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
      const { data, error } = await supabase.rpc('close_shift_v2', args);
      if (error) throw new Error(error.message);
      const result = data as unknown as CloseShiftResult;

      // S29 Wave 6.D — fire-and-forget PDF generation. We await it but DO NOT throw
      // on failure; the draft z_reports row already exists in DB, the manager can
      // retry generation from BO Z-Reports page.
      if (result.zreport_id) {
        try {
          await supabase.functions.invoke('generate-zreport-pdf', {
            body:    { zreport_id: result.zreport_id },
            headers: { 'x-idempotency-key': crypto.randomUUID() },
          });
        } catch (pdfErr) {
          console.warn('[close-shift] z-report PDF generation failed; retry from BO', pdfErr);
        }
      }

      return result;
    },
    onSuccess: () => {
      clearShift();
      void qc.invalidateQueries({ queryKey: ['pos_sessions'] });
    },
  });
}
