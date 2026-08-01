// apps/backoffice/src/features/reports/hooks/useWastageReport.ts
// S30 Wave 4.1 — Query hook for get_wastage_report RPC.
// Audit Reports 2026-08-01 (R-02 / R-08) — repointed v1 → v2 : fenêtre résolue
// dans business_config.timezone (v1 bornait en UTC des dates métier locales,
// donc perdait les pertes saisies avant 08:00 locales) et `truncated` exposé
// (les lignes de détail sont plafonnées à 500 côté serveur).

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
  /** Serveur : les lignes de détail sont plafonnées à 500. */
  truncated:   boolean;
}

export interface UseWastageReportParams {
  start: string;
  end:   string;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

export function useWastageReport(params: UseWastageReportParams) {
  return useQuery<WastageReportData, Error>({
    queryKey: ['reports', 'wastage', params.start, params.end],
    queryFn:  async () => {
      // v2 est dans les types générés : plus besoin du `(supabase as any)` qui
      // traînait depuis S30 et qui empilait 13 erreurs no-unsafe-* sur ce hook.
      const { data, error } = await supabase.rpc('get_wastage_report_v2', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;

      // RPC returns { period, summary:{ total_value, … }, by_product:[…],
      // lines:[…], truncated } where each line carries `created_by_name`. Map to
      // this hook's stable { lines, total_value, period, truncated } contract.
      const raw     = asRecord(data);
      const summary = asRecord(raw.summary);
      const period  = asRecord(raw.period);
      const rawLines = Array.isArray(raw.lines) ? (raw.lines as unknown[]) : [];

      return {
        lines: rawLines.map((line): WastageReportLine => {
          const l = asRecord(line);
          return {
            id:           toStr(l.id),
            product_id:   toStr(l.product_id),
            product_name: toStr(l.product_name),
            type:         toStr(l.type),
            qty:          toNum(l.qty),
            value:        toNum(l.value),
            created_at:   toStr(l.created_at),
            recorded_by:  typeof l.recorded_by === 'string'
              ? l.recorded_by
              : typeof l.created_by_name === 'string'
                ? l.created_by_name
                : null,
          };
        }),
        total_value: toNum(summary.total_value),
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        truncated: raw.truncated === true,
      } satisfies WastageReportData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
