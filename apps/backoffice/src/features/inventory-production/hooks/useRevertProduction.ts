// apps/backoffice/src/features/inventory-production/hooks/useRevertProduction.ts
//
// Calls `revert_production_v1`. ADMIN+ only (server-side gate).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type RevertProductionErrorCode =
  | 'forbidden'
  | 'reason_required'
  | 'production_not_found'
  | 'already_reverted'
  | 'production_too_old'
  | 'unknown';

export class RevertProductionError extends Error {
  constructor(public code: RevertProductionErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'RevertProductionError';
  }
}

export interface RevertProductionArgs {
  productionId: string;
  reason:       string;
}

function classify(message: string): RevertProductionErrorCode {
  if (message.includes('forbidden'))              return 'forbidden';
  if (message.includes('reason_required'))        return 'reason_required';
  if (message.includes('production_not_found'))   return 'production_not_found';
  if (message.includes('already_reverted'))       return 'already_reverted';
  if (message.includes('production_too_old'))     return 'production_too_old';
  return 'unknown';
}

export function useRevertProduction() {
  const qc = useQueryClient();
  return useMutation<unknown, RevertProductionError, RevertProductionArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.rpc('revert_production_v1', {
        p_production_id: args.productionId,
        p_reason:        args.reason,
      });
      if (error) throw new RevertProductionError(classify(error.message), error.message);
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inventory-production', 'records'] }),
        qc.invalidateQueries({ queryKey: ['stock-levels'] }),
      ]);
    },
  });
}
