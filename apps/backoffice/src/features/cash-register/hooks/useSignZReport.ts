// apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts
//
// S29 Wave 6.A.3 — sign Z-Report.
// S37 BO-01 — bumped to sign_zreport_v2: the manager PIN is now an RPC arg
// actually validated server-side (verify_user_pin). v1 read no PIN at all —
// the x-manager-pin header was sent to an EF wrapper that was never deployed.
// Replay safety is intrinsic to the RPC (idempotent replay on already-signed).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { Z_REPORTS_QK } from './useZReports.js';

export interface SignZReportResult {
  zreport_id:        string;
  status:            'signed';
  signed_at:         string;
  signed_by:         string;
  pdf_storage_path:  string | null;
  idempotent_replay: boolean;
}

export function useSignZReport() {
  const qc = useQueryClient();

  const mutation = useMutation<SignZReportResult, Error, { zreportId: string; managerPin: string }>({
    mutationFn: async ({ zreportId, managerPin }) => {
      const { data, error } = await supabase.rpc('sign_zreport_v2', {
        p_zreport_id: zreportId,
        p_manager_pin: managerPin,
      });
      if (error) throw error;
      return data as unknown as SignZReportResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: Z_REPORTS_QK });
    },
  });

  return {
    ...mutation,
    // S37: kept as a no-op for call-site compatibility (SignZReportModal) —
    // replay safety now lives in the RPC's idempotent-replay branch.
    resetIdempotency: (): void => {},
  };
}
