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
  // Lot A1 (campagne Reports 2026-08-15) — la RPC émet lot/motif depuis v1 et le
  // hook les jetait, alors que la tuile du hub promet « by product & lot ».
  lot_id:           string | null;
  lot_batch_number: string | null;
  reason:           string | null;
}

// Audit R-09 — la RPC calcule déjà cette ventilation (manuel vs péremption, en
// qty et en valeur), que le hook jetait : la tuile du hub promet « Manual waste
// + auto spoilage by product & lot » alors que la page n'affichait qu'une liste
// de lignes brutes, sans jamais répondre à « quel produit me coûte le plus ».
export interface WastageByProductRow {
  product_id:         string;
  product_name:       string;
  manual_waste_qty:   number;
  manual_waste_value: number;
  spoilage_qty:       number;
  spoilage_value:     number;
  total_qty:          number;
  total_value:        number;
}

export interface WastageReportData {
  lines:       WastageReportLine[];
  by_product:  WastageByProductRow[];
  total_value: number;
  /** Ventilation du total : perte saisie manuellement vs péremption auto. */
  manual_value:   number;
  spoilage_value: number;
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
      const rawByProduct = Array.isArray(raw.by_product) ? (raw.by_product as unknown[]) : [];

      return {
        by_product: rawByProduct.map((entry): WastageByProductRow => {
          const p = asRecord(entry);
          return {
            product_id:         toStr(p.product_id),
            product_name:       toStr(p.product_name, '—'),
            manual_waste_qty:   toNum(p.manual_waste_qty),
            manual_waste_value: toNum(p.manual_waste_value),
            spoilage_qty:       toNum(p.spoilage_qty),
            spoilage_value:     toNum(p.spoilage_value),
            total_qty:          toNum(p.total_qty),
            total_value:        toNum(p.total_value),
          };
        }),
        manual_value:   toNum(summary.total_manual_waste_value),
        spoilage_value: toNum(summary.total_spoilage_value),
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
            lot_id:           typeof l.lot_id === 'string' ? l.lot_id : null,
            lot_batch_number: typeof l.lot_batch_number === 'string' ? l.lot_batch_number : null,
            reason:           typeof l.reason === 'string' ? l.reason : null,
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
