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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('get_wastage_report_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // RPC returns { period, summary:{ total_value, … }, by_product:[…], lines:[…] }
      // where each line carries `created_by_name`. Map to this hook's stable
      // { lines, total_value, period } contract.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (data ?? {}) as any;
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        lines: ((raw.lines ?? []) as any[]).map((l) => ({
          ...l,
          recorded_by: l.recorded_by ?? l.created_by_name ?? null,
        })) as WastageReportLine[],
        total_value: Number(raw.summary?.total_value ?? 0),
        period:      raw.period ?? { start: params.start, end: params.end },
      } satisfies WastageReportData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
