// apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts
//
// S29 Wave 4.A.1 — Mutation hook to call EF generate-pdf and return signed_url.
// S30 Wave 3.2 — Extended to 17 templates (added 5 bakery reports).

import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type PdfTemplate =
  | 'pnl' | 'bs' | 'cf' | 'basket'
  | 'recipe_overview' | 'recipe_timeline'
  | 'sales_by_hour' | 'sales_by_category' | 'sales_by_staff'
  | 'stock_variance' | 'production_yield' | 'audit'
  | 'wastage' | 'payment_by_method' | 'pb1' | 'stock_movements' | 'perishable_turnover';

export interface GeneratePdfArgs {
  template:        PdfTemplate;
  data:            object;
  period?:         { start: string; end: string };
  filename:        string;   // sans extension .pdf
  comparePrevious?: { data: object };
}

export interface GeneratePdfResult {
  storage_path: string;
  signed_url:   string;
  expires_at:   string;
}

export function useGeneratePdf() {
  return useMutation<GeneratePdfResult, Error, GeneratePdfArgs>({
    mutationFn: async (args) => {
      const { data, error } = await supabase.functions.invoke('generate-pdf', { body: args });
      if (error) throw error;
      const result = data as GeneratePdfResult | { error: string };
      if ('error' in result) throw new Error(result.error);
      return result;
    },
  });
}
