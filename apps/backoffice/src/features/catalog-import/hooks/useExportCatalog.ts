// apps/backoffice/src/features/catalog-import/hooks/useExportCatalog.ts
// S41 — wraps export_catalog_v1 (read-only, returns the import payload shape).

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { CatalogPayload } from '../parseCatalogWorkbook.js';

export function useExportCatalog() {
  return useMutation<CatalogPayload, Error, void>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('export_catalog_v1');
      if (error !== null) throw new Error(error.message);
      return data as unknown as CatalogPayload;
    },
  });
}
