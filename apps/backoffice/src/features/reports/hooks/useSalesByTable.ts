// apps/backoffice/src/features/reports/hooks/useSalesByTable.ts
//
// Query hook pour la famille `get_sales_by_table` — les ventes par table de salle.
// Périmètre : dine-in canoniques AVEC table (une dine-in sans table est un
// cas non autorisé — arbitrage 2026-08-17 — et n'entre pas). La heatmap
// arrive en format long (table × jour ISO, commandes ET CA) ; l'affichage
// retenu est le NOMBRE de commandes, le CA sert le tooltip.
// S3-22 (2026-11-11) — `p_filters` ne porte ici que le moyen de paiement : le
// type et la table sont fixés par le rapport lui-même. Même prédicat que
// `get_sales_by_product`, sur la période ET la fenêtre précédente.

import { useQuery } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import {
  salesFiltersKey, toRpcFilters, type SalesOrderFilters,
} from '../utils/salesFilters.js';

export interface TableRow {
  table_number: string;
  seats:        number | null;
  orders:       number;
  revenue:      number;
  avg_ticket:   number;
  revenue_prev: number;
}

export interface TableDowRow {
  table_number: string;
  dow:          number;  // ISO : 1 = lundi … 7 = dimanche
  orders:       number;
  revenue:      number;
}

export interface SalesByTableSummary {
  revenue:       number;
  revenue_prev:  number;
  orders:        number;
  orders_prev:   number;
  tables_used:   number;
  active_tables: number;
  active_seats:  number;
}

export interface SalesByTableData {
  period:       { start: string; end: string };
  period_prev:  { start: string; end: string };
  summary:      SalesByTableSummary;
  by_table:     TableRow[];
  by_table_dow: TableDowRow[];
}

export interface UseSalesByTableParams {
  start:    string;
  end:      string;
  /** Seul le moyen de paiement a un sens sur ce rapport. */
  filters?: Pick<SalesOrderFilters, 'payment_method'>;
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toPeriod(v: unknown): { start: string; end: string } {
  const o = (v ?? {}) as Record<string, unknown>;
  return { start: toStr(o.start), end: toStr(o.end) };
}

export function useSalesByTable(params: UseSalesByTableParams) {
  const { start, end, filters } = params;
  return useQuery<SalesByTableData, Error>({
    queryKey: ['sales-by-table', start, end, ...salesFiltersKey(filters)],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      // `exactOptionalPropertyTypes` : on omet l'arg optionnel plutôt que de
      // poser `undefined`.
      const args: { p_start_date: string; p_end_date: string; p_filters?: Json } = {
        p_start_date: start,
        p_end_date:   end,
      };
      const rpcFilters = toRpcFilters(filters);
      if (rpcFilters !== null) args.p_filters = rpcFilters;
      const { data, error } = await supabase.rpc('get_sales_by_table_v4', args);
      if (error) throw error as Error;

      const r       = (data ?? {}) as Record<string, unknown>;
      const summary = (r.summary ?? {}) as Record<string, unknown>;
      const tables  = Array.isArray(r.by_table)     ? (r.by_table as unknown[])     : [];
      const dows    = Array.isArray(r.by_table_dow) ? (r.by_table_dow as unknown[]) : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        summary: {
          revenue:       toNum(summary.revenue),
          revenue_prev:  toNum(summary.revenue_prev),
          orders:        toNum(summary.orders),
          orders_prev:   toNum(summary.orders_prev),
          tables_used:   toNum(summary.tables_used),
          active_tables: toNum(summary.active_tables),
          active_seats:  toNum(summary.active_seats),
        },
        by_table: tables.map((t) => {
          const o = (t ?? {}) as Record<string, unknown>;
          return {
            table_number: toStr(o.table_number),
            seats:        toNumOrNull(o.seats),
            orders:       toNum(o.orders),
            revenue:      toNum(o.revenue),
            avg_ticket:   toNum(o.avg_ticket),
            revenue_prev: toNum(o.revenue_prev),
          };
        }),
        by_table_dow: dows.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return {
            table_number: toStr(o.table_number),
            dow:          toNum(o.dow),
            orders:       toNum(o.orders),
            revenue:      toNum(o.revenue),
          };
        }),
      } satisfies SalesByTableData;
    },
  });
}
