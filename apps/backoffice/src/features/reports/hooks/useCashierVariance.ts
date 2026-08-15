// apps/backoffice/src/features/reports/hooks/useCashierVariance.ts
//
// Wraps `get_cashier_variance_v2(p_start_date, p_end_date)` — read-only cashier
// shift-variance report (fiche 12 D2.4). Returns a JSONB envelope.
//
// Audit Reports 2026-08-01 lot C / D2 bis — bumped v1 -> v2 : la v1 etait gatee
// sur `reports.read`, le code le plus faible de la famille, que tout porteur de
// rapport possede. Or ce rapport expose les ecarts de caisse par caissier
// (manquants, pires ecarts, matrice par jour de semaine) : c'est de la donnee de
// controle financier. Gate et route montent a reports.financial.read.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

export interface DowCell {
  dow:            number; // 0=Sunday … 6=Saturday
  sessions:       number;
  total_variance: number;
}

export interface CashierVarianceRow {
  cashier_id:     string;
  cashier_name:   string;
  sessions_count: number;
  cash: {
    total_variance: number;
    avg_variance:   number;
    total_short:    number;
    short_count:    number;
    over_count:     number;
    worst_variance: number;
  };
  qris: { counted_sessions: number; total_variance: number };
  card: { counted_sessions: number; total_variance: number };
  dow_cash: DowCell[];
}

export interface CashierVarianceReport {
  generated_at: string;
  start_date:   string;
  end_date:     string;
  timezone:     string;
  cashiers:     CashierVarianceRow[];
  totals: {
    sessions_count: number;
    cash: { total_variance: number; total_short: number; short_count: number; over_count: number };
    qris: { counted_sessions: number; total_variance: number };
    card: { counted_sessions: number; total_variance: number };
  };
}

export const CASHIER_VARIANCE_QK = ['reports', 'cashier-variance'] as const;

// Lot A1 (campagne Reports 2026-08-15) — le fallback serveur d'une période sans
// shift fermé rend `totals` réduit à `{ sessions_count: 0 }`, sans les
// sous-objets cash/qris/card que l'interface déclare non-optionnels. Le cast
// aveugle laissait ce TypeError latent traverser ; on normalise champ par champ.
function parseCounted(v: unknown): { counted_sessions: number; total_variance: number } {
  const o = asRecord(v);
  return {
    counted_sessions: toNum(o.counted_sessions),
    total_variance:   toNum(o.total_variance),
  };
}

function parseReport(data: unknown, start: string, end: string): CashierVarianceReport {
  const raw       = asRecord(data);
  const rawTotals = asRecord(raw.totals);
  const totalsCash = asRecord(rawTotals.cash);
  return {
    generated_at: toStr(raw.generated_at),
    start_date:   toStr(raw.start_date, start),
    end_date:     toStr(raw.end_date, end),
    timezone:     toStr(raw.timezone),
    cashiers: asArray(raw.cashiers).map((entry): CashierVarianceRow => {
      const c    = asRecord(entry);
      const cash = asRecord(c.cash);
      return {
        cashier_id:     toStr(c.cashier_id),
        cashier_name:   toStr(c.cashier_name, '—'),
        sessions_count: toNum(c.sessions_count),
        cash: {
          total_variance: toNum(cash.total_variance),
          avg_variance:   toNum(cash.avg_variance),
          total_short:    toNum(cash.total_short),
          short_count:    toNum(cash.short_count),
          over_count:     toNum(cash.over_count),
          worst_variance: toNum(cash.worst_variance),
        },
        qris: parseCounted(c.qris),
        card: parseCounted(c.card),
        dow_cash: asArray(c.dow_cash).map((cell): DowCell => {
          const d = asRecord(cell);
          return {
            dow:            toNum(d.dow),
            sessions:       toNum(d.sessions),
            total_variance: toNum(d.total_variance),
          };
        }),
      };
    }),
    totals: {
      sessions_count: toNum(rawTotals.sessions_count),
      cash: {
        total_variance: toNum(totalsCash.total_variance),
        total_short:    toNum(totalsCash.total_short),
        short_count:    toNum(totalsCash.short_count),
        over_count:     toNum(totalsCash.over_count),
      },
      qris: parseCounted(rawTotals.qris),
      card: parseCounted(rawTotals.card),
    },
  };
}

export function useCashierVariance(start: string, end: string) {
  return useQuery<CashierVarianceReport>({
    queryKey: [...CASHIER_VARIANCE_QK, start, end] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_cashier_variance_v2', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) {
        if (error.code === '42501') throw new Error('permission_denied');
        throw error;
      }
      return parseReport(data, start, end);
    },
  });
}
