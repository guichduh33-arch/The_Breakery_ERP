// apps/backoffice/src/features/cash-register/hooks/useVoidZReport.ts
//
// S29 Wave 6.A.4 — void Z-Report (admin only, reason min 10 char).
// S50 V2a-i T5 — bumped to void_zreport_v2: a manager PIN is now an RPC arg validated
// server-side (_verify_pin_with_lockout), mirroring sign_zreport_v2. Voiding a signed
// shift close is at least as sensitive as signing it. Replay safety is intrinsic to the
// RPC (idempotent replay on an already-voided report), so the old x-idempotency-key header
// is dropped — same move as useSignZReport (S37).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { Z_REPORTS_QK } from './useZReports.js';

export interface VoidZReportResult {
  zreport_id:        string;
  status:            'voided';
  voided_at:         string;
  idempotent_replay: boolean;
}

export function useVoidZReport() {
  const qc = useQueryClient();

  const mutation = useMutation<VoidZReportResult, Error, { zreportId: string; reason: string; managerPin: string }>({
    mutationFn: async ({ zreportId, reason, managerPin }) => {
      const { data, error } = await supabase.rpc('void_zreport_v2', {
        p_zreport_id:  zreportId,
        p_reason:      reason,
        p_manager_pin: managerPin,
      });
      if (error) throw error;
      return data as unknown as VoidZReportResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: Z_REPORTS_QK });
    },
  });

  return {
    ...mutation,
    // S50 T5: kept as a no-op for call-site compatibility (VoidZReportModal) —
    // replay safety now lives in the RPC's idempotent-replay branch.
    resetIdempotency: (): void => {},
  };
}
