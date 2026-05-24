// apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts
//
// S29 Wave 6.A.3 — sign Z-Report (PIN-en-header S25 pattern + idempotency).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
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
  const idempotencyRef = useRef<string>(crypto.randomUUID());
  const qc = useQueryClient();

  const mutation = useMutation<SignZReportResult, Error, { zreportId: string; managerPin: string }>({
    mutationFn: async ({ zreportId, managerPin }) => {
      const { data, error } = await supabase.rpc(
        'sign_zreport_v1',
        { p_zreport_id: zreportId },
        // headers passed via 3rd arg; not officially typed but works at runtime
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          headers: {
            'x-manager-pin':     managerPin,
            'x-idempotency-key': idempotencyRef.current,
          },
        } as any
      );
      if (error) throw error;
      return data as unknown as SignZReportResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: Z_REPORTS_QK });
      idempotencyRef.current = crypto.randomUUID();
    },
  });

  return {
    ...mutation,
    resetIdempotency: (): void => { idempotencyRef.current = crypto.randomUUID(); },
  };
}
