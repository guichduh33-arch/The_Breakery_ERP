// apps/backoffice/src/features/reports/hooks/useDailySales.ts
// S40 Wave B1 — Query hook for get_daily_sales RPC.
// Lot I (campagne Reports, 2026-08-15) — bump v1 → v2 : payload additif
// (summary +discount_total/discount_orders_count/voids_count/voids_value,
// racine +sessions) pour la tuile Discounts et la carte Register close de
// la maquette 4c. Parse défensif : les champs neufs tolèrent l'absence.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { asArray, asRecord, toNum, toStr } from '../utils/parse.js';

// `../utils/parse.js` n'expose pas de variante nullable — `cashier` est un
// LEFT JOIN côté RPC (peut être NULL), donc un fallback string vide ferait
// mentir l'UI. Helpers locaux, hors périmètre de parse.ts.
function toStrOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// `variance_total` est NULL tant que la session est ouverte : un 0 par défaut
// afficherait « écart de caisse nul » là où rien n'a encore été compté.
function toNumOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface DailySalesRow {
  date:        string;
  order_count: number;
  gross:       number;
  refunds:     number;
  net:         number;
  aov:         number;
}

export interface DailySalesSummary {
  total:                   number;
  order_count:             number;
  aov:                     number;
  refund_total:            number;
  net:                     number;
  discount_total:          number;
  discount_orders_count:   number;
  voids_count:             number;
  voids_value:             number;
}

export interface DailySalesSession {
  id:             string;
  cashier:        string | null;
  opened_at:      string;
  opening_cash:   number;
  status:         string;
  closed_at:      string | null;
  variance_total: number | null;
}

export interface DailySalesData {
  period:   { start: string; end: string };
  summary:  DailySalesSummary;
  by_day:   DailySalesRow[];
  sessions: DailySalesSession[];
}

export interface UseDailySalesParams {
  start: string;
  end:   string;
}

export function useDailySales(params: UseDailySalesParams) {
  return useQuery<DailySalesData, Error>({
    queryKey: ['reports', 'daily-sales', params.start, params.end],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_daily_sales_v2', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      const raw     = asRecord(data);
      const period  = asRecord(raw.period);
      const summary = asRecord(raw.summary);
      return {
        period: {
          start: toStr(period.start, params.start),
          end:   toStr(period.end,   params.end),
        },
        summary: {
          total:                  toNum(summary.total),
          order_count:            toNum(summary.order_count),
          aov:                    toNum(summary.aov),
          refund_total:           toNum(summary.refund_total),
          net:                    toNum(summary.net),
          discount_total:         toNum(summary.discount_total),
          discount_orders_count:  toNum(summary.discount_orders_count),
          voids_count:            toNum(summary.voids_count),
          voids_value:            toNum(summary.voids_value),
        },
        by_day: asArray(raw.by_day).map((r): DailySalesRow => {
          const o = asRecord(r);
          return {
            date:        toStr(o.date),
            order_count: toNum(o.order_count),
            gross:       toNum(o.gross),
            refunds:     toNum(o.refunds),
            net:         toNum(o.net),
            aov:         toNum(o.aov),
          };
        }),
        sessions: asArray(raw.sessions).map((r): DailySalesSession => {
          const o = asRecord(r);
          return {
            id:             toStr(o.id),
            cashier:        toStrOrNull(o.cashier),
            opened_at:      toStr(o.opened_at),
            opening_cash:   toNum(o.opening_cash),
            status:         toStr(o.status),
            closed_at:      toStrOrNull(o.closed_at),
            variance_total: toNumOrNull(o.variance_total),
          };
        }),
      } satisfies DailySalesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
