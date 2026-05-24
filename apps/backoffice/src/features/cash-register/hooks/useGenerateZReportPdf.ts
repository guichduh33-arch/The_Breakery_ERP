// apps/backoffice/src/features/cash-register/hooks/useGenerateZReportPdf.ts
//
// S29 Wave 6.A.5 — call EF generate-zreport-pdf with required idempotency key.

import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '@/lib/supabase.js';

export interface GenerateZReportPdfResult {
  storage_path:      string;
  signed_url:        string;
  expires_at:        string;
  status:            'draft' | 'signed' | 'voided';
  idempotent_replay: boolean;
}

export function useGenerateZReportPdf() {
  const idempotencyRef = useRef<string>(crypto.randomUUID());

  const mutation = useMutation<GenerateZReportPdfResult, Error, { zreportId: string }>({
    mutationFn: async ({ zreportId }) => {
      const { data, error } = await supabase.functions.invoke('generate-zreport-pdf', {
        body:    { zreport_id: zreportId },
        headers: { 'x-idempotency-key': idempotencyRef.current },
      });
      if (error) throw error;
      const result = data as GenerateZReportPdfResult | { error?: string };
      if (result && 'error' in result && result.error) throw new Error(result.error);
      return result as GenerateZReportPdfResult;
    },
    onSuccess: () => {
      idempotencyRef.current = crypto.randomUUID();
    },
  });

  return {
    ...mutation,
    resetIdempotency: (): void => { idempotencyRef.current = crypto.randomUUID(); },
  };
}
