// apps/pos/src/features/shift/hooks/useCloseShift.ts
// Session 13 / Phase 3.C — React Query mutation wrapper around close_shift_v1.
// Session 29 / Wave 1.B — bumped to close_shift_v2 (adds z_report draft creation).
// Session 29 / Wave 6.D — after successful close_shift_v2, chain EF generate-zreport-pdf
// (non-blocking: PDF generation failure does NOT roll back the shift close; user can
// retry from the Z-Reports page in BO).
// S60 (12 D1.4) — bumped to close_shift_v3: the variance note is now enforced
// server-side (ERRCODE P0001 variance_note_required) when |variance| exceeds
// business_config.shift_variance_threshold_abs/pct and no note was provided;
// mapped to a friendly toast here instead of the raw RPC error message.
// S66 (12 D2.1) — bumped to close_shift_v4: above the (higher) PIN thresholds
// (business_config.shift_variance_pin_threshold_abs/pct), the close requires a
// designated approver (approver_id) + their 6-digit PIN, validated server-side
// via _verify_pin_with_lockout. New error codes mapped below.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useShiftStore } from '@/stores/shiftStore';

export interface CloseShiftInput {
  session_id:    string;
  counted_cash:  number;
  notes?:        string;
  idempotency_key?: string;
  /** S66 — required by the server when |variance| exceeds the PIN threshold. */
  approver_id?:  string;
  manager_pin?:  string;
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
  variance_approved_by: string | null;
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
        p_approver_id?:    string;
        p_manager_pin?:    string;
      } = {
        p_session_id:   input.session_id,
        p_counted_cash: input.counted_cash,
      };
      if (input.notes !== undefined)            args.p_notes = input.notes;
      if (input.idempotency_key !== undefined)  args.p_idempotency_key = input.idempotency_key;
      if (input.approver_id !== undefined)      args.p_approver_id = input.approver_id;
      if (input.manager_pin !== undefined)      args.p_manager_pin = input.manager_pin;
      const { data, error } = await supabase.rpc('close_shift_v4', args);
      if (error) {
        // S60 (12 D1.4): the above-threshold variance note is enforced
        // server-side (ERRCODE P0001 variance_note_required). The UI
        // already blocks this locally (CloseShiftModal.noteRequired), but a
        // direct RPC call (or a client/server threshold drift) still hits it —
        // map it to the same friendly copy the caller's catch block toasts.
        if (error.message.includes('variance_note_required')) {
          throw new Error('A note is required: the variance is above the configured threshold');
        }
        // S66 (12 D2.1): manager-PIN gate on large variances (close_shift_v4).
        if (error.message.includes('pin_approval_required')) {
          throw new Error('Manager approval is required: the variance is above the manager-approval threshold');
        }
        if (error.message.includes('approver_not_authorized')) {
          throw new Error('The selected approver is not allowed to approve shift variances');
        }
        if (error.message.includes('invalid_pin')) {
          throw new Error('Invalid manager PIN');
        }
        if (error.message.includes('account_locked')) {
          throw new Error('Manager account locked after repeated failed PINs — try again in 15 minutes');
        }
        throw new Error(error.message);
      }
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
