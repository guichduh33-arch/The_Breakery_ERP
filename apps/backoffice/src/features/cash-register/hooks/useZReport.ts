// apps/backoffice/src/features/cash-register/hooks/useZReport.ts
//
// S29 Wave 6.A.2 — fetch single Z-Report (full snapshot JSONB).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { Z_REPORTS_QK } from './useZReports.js';

export interface ZReportDetail {
  id:                 string;
  shift_id:           string;
  generated_at:       string;
  signed_at:          string | null;
  signed_by:          string | null;
  signed_by_name:     string | null;
  voided_at:          string | null;
  voided_by:          string | null;
  void_reason:        string | null;
  pdf_storage_path:   string | null;
  status:             'draft' | 'signed' | 'voided';
  snapshot:           Record<string, unknown>;
}

export function useZReport(zreportId: string | undefined) {
  return useQuery<ZReportDetail>({
    queryKey: [...Z_REPORTS_QK, 'detail', zreportId ?? null] as const,
    enabled:  !!zreportId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_zreport_snapshot_v1', { p_zreport_id: zreportId! });
      if (error) throw error;
      return data as unknown as ZReportDetail;
    },
  });
}
