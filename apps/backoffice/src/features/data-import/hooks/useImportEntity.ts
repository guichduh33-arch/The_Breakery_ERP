// apps/backoffice/src/features/data-import/hooks/useImportEntity.ts
// Wraps def.rpcName(p_payload, p_dry_run, p_idempotency_key). dryRun=true → report only.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { EntityImportDef, EntityRow, ImportReport } from '../entityImportDef.js';

interface ImportVars {
  payload: EntityRow[];
  dryRun: boolean;
  idempotencyKey?: string;
}

export function useImportEntity(def: EntityImportDef) {
  const qc = useQueryClient();
  return useMutation<ImportReport, Error, ImportVars>({
    mutationFn: async ({ payload, dryRun, idempotencyKey }) => {
      const { data, error } = await supabase.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        def.rpcName as any,
        {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          p_payload: payload as any,
          p_dry_run: dryRun,
          p_idempotency_key: idempotencyKey ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      );
      if (error !== null) throw new Error(error.message);
      return data as unknown as ImportReport;
    },
    onSuccess: async (_report, vars) => {
      if (!vars.dryRun) {
        await Promise.all(
          def.queryKeysToInvalidate.map((key) => qc.invalidateQueries({ queryKey: key as unknown[] })),
        );
      }
    },
  });
}
