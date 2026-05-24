// apps/backoffice/src/features/cash-register/hooks/useVoidZReport.ts
//
// S29 Wave 6.A.4 — void Z-Report (admin only, reason min 10 char).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '@/lib/supabase.js';
import { Z_REPORTS_QK } from './useZReports.js';

export interface VoidZReportResult {
  zreport_id:        string;
  status:            'voided';
  voided_at:         string;
  idempotent_replay: boolean;
}

export function useVoidZReport() {
  const idempotencyRef = useRef<string>(crypto.randomUUID());
  const qc = useQueryClient();

  const mutation = useMutation<VoidZReportResult, Error, { zreportId: string; reason: string }>({
    mutationFn: async ({ zreportId, reason }) => {
      const { data, error } = await supabase.rpc(
        'void_zreport_v1',
        { p_zreport_id: zreportId, p_reason: reason },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          headers: { 'x-idempotency-key': idempotencyRef.current },
        } as any
      );
      if (error) throw error;
      return data as unknown as VoidZReportResult;
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
