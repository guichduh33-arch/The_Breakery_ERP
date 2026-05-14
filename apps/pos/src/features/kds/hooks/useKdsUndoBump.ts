// apps/pos/src/features/kds/hooks/useKdsUndoBump.ts
//
// Session 13 / Phase 4.B — RPC mutation wrapping `kds_undo_bump_v1`.
// The backend enforces the 60s window (raises P0012 if expired). The UI
// hides the Undo affordance after 60s — both layers agree.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

const UNDO_WINDOW_EXPIRED = 'P0012';

interface RpcError {
  code?: string;
  message: string;
}

interface RpcResult {
  data: unknown;
  error: RpcError | null;
}

interface LooseSupabase {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
}

const sb = supabase as unknown as LooseSupabase;

export function useKdsUndoBump() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (orderItemId: string) => {
      const { error } = await sb.rpc('kds_undo_bump_v1', {
        p_order_item_id: orderItemId,
      });
      if (error) {
        const err = Object.assign(new Error(error.message), { code: error.code });
        throw err;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['kds'] });
    },
  });
}

export { UNDO_WINDOW_EXPIRED };
