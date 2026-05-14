// apps/backoffice/src/features/print-queue/hooks/useCancelPrintJob.ts
// Session 13 / Phase 5.A — mutation wrapper for cancel_print_job_v1.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { PRINT_QUEUE_KEY } from './usePrintQueue.js';

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc as unknown as RpcFn;
}

export function useCancelPrintJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc()('cancel_print_job_v1', { p_id: id });
      if (error !== null) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: PRINT_QUEUE_KEY });
    },
  });
}
