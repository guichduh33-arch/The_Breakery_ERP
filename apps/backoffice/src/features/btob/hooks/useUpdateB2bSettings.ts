// apps/backoffice/src/features/btob/hooks/useUpdateB2bSettings.ts
//
// Session 39 / Wave C2 — partial-patch b2b_settings via update_b2b_settings_v1 RPC.
// Gate: settings.update (enforced server-side by RPC).
// Server raises P0001 with codes like `aging_buckets_not_contiguous_at_2` on
// validation failure; the error message propagates to the caller unchanged.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_SETTINGS_QUERY_KEY, type B2bSettings } from './useB2bSettings.js';

export function useUpdateB2bSettings() {
  const qc = useQueryClient();
  return useMutation<B2bSettings, Error, Partial<B2bSettings>>({
    mutationFn: async (patch: Partial<B2bSettings>) => {
      // Cast through unknown to satisfy the generated Json type constraint;
      // the RPC accepts a partial JSONB patch at runtime.
      const { data, error } = await supabase.rpc('update_b2b_settings_v1', {
        p_patch: patch as unknown as import('@breakery/supabase').Json,
      });
      if (error) throw error;
      return data as unknown as B2bSettings;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: B2B_SETTINGS_QUERY_KEY });
    },
  });
}
