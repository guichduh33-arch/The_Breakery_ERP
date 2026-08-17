// apps/backoffice/src/features/accounting-mappings/hooks/useUpdateMapping.ts
//
// Session 13 / Phase 6.C — Wraps the `update_accounting_mapping` RPC family. ADMIN+ via
// `accounting.mapping.update`. The RPC inserts an `audit_logs` row per call.
// Lot C (audit accounting 2026-08-17) : bumped v1->v2 — v2 only requires the
// target account to be active+postable when p_is_active=true, so a mapping
// pointing at an already-deactivated account can still be deactivated.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { MAPPINGS_QUERY_KEY } from './useMappings.js';

export interface UpdateMappingArgs {
  mapping_key:  string;
  account_code: string;
  is_active:    boolean;
  reason:       string;
}

export function useUpdateMapping() {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdateMappingArgs>({
    mutationFn: async ({ mapping_key, account_code, is_active, reason }) => {
      const { error } = await supabase.rpc('update_accounting_mapping_v2', {
        p_mapping_key:  mapping_key,
        p_account_code: account_code,
        p_is_active:    is_active,
        p_reason:       reason,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: MAPPINGS_QUERY_KEY });
    },
  });
}
