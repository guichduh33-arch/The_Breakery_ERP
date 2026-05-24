// apps/backoffice/src/features/cash-register/hooks/useZReports.ts
//
// S29 Wave 6.A.1 — list Z-Reports with optional status + date range filter.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type ZReportStatus = 'draft' | 'signed' | 'voided';

export interface ZReportListRow {
  id:                  string;
  shift_id:            string;
  generated_at:        string;
  signed_at:           string | null;
  signed_by:           string | null;
  signed_by_name:      string | null;
  voided_at:           string | null;
  voided_by:           string | null;
  void_reason:         string | null;
  pdf_storage_path:    string | null;
  status:              ZReportStatus;
}

export interface ZReportsFilters {
  status?:        ZReportStatus;
  startDate?:     string; // YYYY-MM-DD, filters generated_at >= startDate
  endDate?:       string; // YYYY-MM-DD, filters generated_at <= endDate + '23:59:59'
}

export const Z_REPORTS_QK = ['z_reports'] as const;

export function useZReports(filters: ZReportsFilters = {}) {
  return useQuery<ZReportListRow[]>({
    queryKey: [...Z_REPORTS_QK, 'list', filters] as const,
    staleTime: 30_000,
    queryFn: async () => {
      let q = supabase
        .from('z_reports')
        .select('id, shift_id, generated_at, signed_at, signed_by, voided_at, voided_by, void_reason, pdf_storage_path, status, signed_by_profile:user_profiles!z_reports_signed_by_fkey(full_name)')
        .order('generated_at', { ascending: false })
        .limit(200);
      if (filters.status)    q = q.eq('status', filters.status);
      if (filters.startDate) q = q.gte('generated_at', `${filters.startDate}T00:00:00Z`);
      if (filters.endDate)   q = q.lte('generated_at', `${filters.endDate}T23:59:59Z`);
      const { data, error } = await q;
      if (error) throw error;
      type RawRow = ZReportListRow & { signed_by_profile?: { full_name?: string } | null };
      return (data as RawRow[] | null ?? []).map((r) => ({
        id:               r.id,
        shift_id:         r.shift_id,
        generated_at:     r.generated_at,
        signed_at:        r.signed_at,
        signed_by:        r.signed_by,
        signed_by_name:   r.signed_by_profile?.full_name ?? null,
        voided_at:        r.voided_at,
        voided_by:        r.voided_by,
        void_reason:      r.void_reason,
        pdf_storage_path: r.pdf_storage_path,
        status:           r.status,
      }));
    },
  });
}
