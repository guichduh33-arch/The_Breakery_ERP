// apps/backoffice/src/features/reports/hooks/useWastageReport.ts
// S30 Wave 4.1 — Query hook for get_wastage_report_v1 RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface WastageReportLine {
  id:           string;
  product_id:   string;
  product_name: string;
  type:         string;
  qty:          number;
  value:        number;
  created_at:   string;
  recorded_by?: string | null;
}

export interface WastageReportData {
  lines:       WastageReportLine[];
  total_value: number;
  period:      { start: string; end: string };
}

export interface UseWastageReportParams {
  start: string;
  end:   string;
}

export function useWastageReport(params: UseWastageReportParams) {
  return useQuery<WastageReportData, Error>({
    queryKey: ['reports', 'wastage', params.start, params.end],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_wastage_report_v1', {
        p_start: params.start,
        p_end:   params.end,
      });
      if (error) throw error;
      return data as WastageReportData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
