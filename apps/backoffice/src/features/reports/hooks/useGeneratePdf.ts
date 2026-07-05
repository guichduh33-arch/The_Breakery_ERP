// apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts
//
// S29 Wave 4.A.1 — Mutation hook to call EF generate-pdf and return signed_url.
// S30 Wave 3.2 — Extended to 17 templates (added 5 bakery reports).

import { useMutation } from '@tanstack/react-query';
import { supabaseUrl } from '@/lib/supabase.js';
import { getAccessToken } from '@/lib/accessToken.js';

export type PdfTemplate =
  | 'pnl' | 'bs' | 'cf' | 'basket'
  | 'recipe_overview' | 'recipe_timeline'
  | 'sales_by_hour' | 'sales_by_category' | 'sales_by_staff'
  | 'stock_variance' | 'production_yield' | 'audit'
  | 'wastage' | 'payment_by_method' | 'pb1' | 'stock_movements';

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
      // Direct EF fetch (not supabase.functions.invoke): mirrors the POS
      // money-path so the call carries the PIN-JWT via getAccessToken() and
      // skips the client's `x-app` global header (defense-in-depth vs CORS).
      const accessToken = await getAccessToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'pdf_failed');
      }
      const result = await res.json() as GeneratePdfResult | { error: string };
      if ('error' in result) throw new Error(result.error);
      return result;
    },
  });
}
