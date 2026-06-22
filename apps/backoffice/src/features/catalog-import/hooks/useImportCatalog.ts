// apps/backoffice/src/features/catalog-import/hooks/useImportCatalog.ts
// S41 — wraps import_catalog_v1. dryRun=true → validation report only.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { CatalogPayload } from '../parseCatalogWorkbook.js';

export interface ImportError {
  sheet: string;
  row: number;
  sku: string | null;
  code: string;
  message: string;
}

export interface ImportReport {
  valid: boolean;
  errors: ImportError[];
  summary: Record<string, Record<string, number>>;
  idempotent_replay: boolean;
}

interface ImportVars {
  payload: CatalogPayload;
  dryRun: boolean;
  idempotencyKey?: string;
}

export function useImportCatalog() {
  const qc = useQueryClient();
  return useMutation<ImportReport, Error, ImportVars>({
    mutationFn: async ({ payload, dryRun, idempotencyKey }) => {
      const { data, error } = await supabase.rpc('import_catalog_v1', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p_payload: payload as any,
        p_dry_run: dryRun,
        p_idempotency_key: idempotencyKey ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (error !== null) throw new Error(error.message);
      return data as unknown as ImportReport;
    },
    onSuccess: async (_report, vars) => {
      if (!vars.dryRun) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['products'] }),
          qc.invalidateQueries({ queryKey: ['categories'] }),
        ]);
      }
    },
  });
}
