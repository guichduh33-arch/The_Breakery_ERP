// apps/backoffice/src/features/cash-register/hooks/useGenerateZReportPdf.ts
//
// S29 Wave 6.A.5 — call EF generate-zreport-pdf with required idempotency key.

import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabaseUrl } from '@/lib/supabase.js';
import { getAccessToken } from '@/lib/accessToken.js';

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
      // Direct EF fetch (not supabase.functions.invoke): carries the PIN-JWT via
      // getAccessToken() and skips the client's `x-app` global header (CORS-safe,
      // mirrors the POS money-path). x-idempotency-key is REQUIRED by the EF.
      const accessToken = await getAccessToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-zreport-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          Authorization:       `Bearer ${accessToken}`,
          'x-idempotency-key': idempotencyRef.current,
        },
        body: JSON.stringify({ zreport_id: zreportId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'zreport_pdf_failed');
      }
      const result = await res.json() as GenerateZReportPdfResult | { error?: string };
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
