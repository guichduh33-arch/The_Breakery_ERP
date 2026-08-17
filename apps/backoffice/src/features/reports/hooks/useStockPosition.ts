// apps/backoffice/src/features/reports/hooks/useStockPosition.ts
//
// Query hook pour `get_stock_position_v1` — la photo du stock au soir du jour
// J. Reconstruction ARRIÈRE côté serveur (current_stock − Σ mouvements
// postérieurs à J — robuste au stock initial jamais entré au ledger). La
// valorisation est au WAC COURANT et le contrat l'étiquette (`valuation` =
// 'current_wac') : la page doit l'afficher, jamais le sous-entendre.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type StockPositionStatus = 'ok' | 'below_threshold' | 'at_zero' | 'negative';

export interface StockPositionProductRow {
  product_id:    string;
  name:          string;
  sku:           string | null;
  unit:          string | null;
  category_name: string | null;
  qty:           number;
  wac:           number;
  value:         number;
  min_threshold: number;
  status:        StockPositionStatus;
}

export interface StockPositionCategoryRow {
  category_id:   string | null;
  category_name: string | null;
  value:         number;
  refs:          number;
}

export interface StockPositionSummary {
  total_value:          number;
  refs_tracked:         number;
  refs_in_stock:        number;
  refs_at_zero:         number;
  refs_negative:        number;
  refs_below_threshold: number;
}

export interface StockPositionData {
  as_of:       string;
  timezone:    string;
  valuation:   string;
  summary:     StockPositionSummary;
  by_category: StockPositionCategoryRow[];
  products:    StockPositionProductRow[];
}

const STATUSES: StockPositionStatus[] = ['ok', 'below_threshold', 'at_zero', 'negative'];

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toStrOrNull(v: unknown): string | null {
  return v != null ? toStr(v) : null;
}

function toStatus(v: unknown): StockPositionStatus {
  return STATUSES.includes(v as StockPositionStatus) ? (v as StockPositionStatus) : 'ok';
}

export function useStockPosition(asOf?: string) {
  return useQuery<StockPositionData, Error>({
    queryKey: ['stock-position', asOf ?? 'today'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'get_stock_position_v1',
        asOf !== undefined && asOf !== '' ? { p_as_of: asOf } : {},
      );
      if (error) throw error as Error;

      const r        = (data ?? {}) as Record<string, unknown>;
      const summary  = (r.summary ?? {}) as Record<string, unknown>;
      const cats     = Array.isArray(r.by_category) ? (r.by_category as unknown[]) : [];
      const products = Array.isArray(r.products)    ? (r.products as unknown[])    : [];

      return {
        as_of:     toStr(r.as_of),
        timezone:  toStr(r.timezone),
        valuation: toStr(r.valuation),
        summary: {
          total_value:          toNum(summary.total_value),
          refs_tracked:         toNum(summary.refs_tracked),
          refs_in_stock:        toNum(summary.refs_in_stock),
          refs_at_zero:         toNum(summary.refs_at_zero),
          refs_negative:        toNum(summary.refs_negative),
          refs_below_threshold: toNum(summary.refs_below_threshold),
        },
        by_category: cats.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            category_id:   toStrOrNull(o.category_id),
            category_name: toStrOrNull(o.category_name),
            value:         toNum(o.value),
            refs:          toNum(o.refs),
          };
        }),
        products: products.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            product_id:    toStr(o.product_id),
            name:          toStr(o.name),
            sku:           toStrOrNull(o.sku),
            unit:          toStrOrNull(o.unit),
            category_name: toStrOrNull(o.category_name),
            qty:           toNum(o.qty),
            wac:           toNum(o.wac),
            value:         toNum(o.value),
            min_threshold: toNum(o.min_threshold),
            status:        toStatus(o.status),
          };
        }),
      } satisfies StockPositionData;
    },
  });
}
