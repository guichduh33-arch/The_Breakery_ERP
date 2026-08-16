// apps/backoffice/src/features/reports/hooks/useRefundsReport.ts
//
// Query hook pour `get_refunds_report_v1` — remboursements & voids d'une plage
// de jours métier. La RPC renvoie les événements EN ENTIER (un remboursement
// est rare, le clamp 366 j borne le volume) : les ventilations par jour, motif
// et méthode se recalculent dans la page depuis ces lignes — elles ne peuvent
// pas diverger de la table. Seul le CA brut (dénominateur du taux) vient du
// serveur : il ne se dérive pas des événements.
//
// Deux choses que la RPC porte et que la page DOIT dire :
//   · les LIGNES ANNULÉES AVANT PAIEMENT ne sortent aucun argent — servies à
//     part (summary.cancelled + cancelled_by_product), jamais dans refunded ;
//   · `reason` est un champ LIBRE ; `reason_family` est son regroupement
//     serveur (fr/en/id) — la table garde la raison brute à côté.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type RefundReasonFamily =
  | 'input_error' | 'quality' | 'duplicate' | 'customer_change' | 'other';

export interface RefundPaymentSlice {
  method: string;
  amount: number;
}

export interface RefundEvent {
  id:            string;
  refund_number: string;
  order_id:      string;
  order_number:  string;
  created_at:    string;
  business_date: string;
  is_full_void:  boolean;
  reason:        string;
  reason_family: RefundReasonFamily;
  tax_refunded:  number;
  total:         number;
  refunded_by:   { id: string | null; name: string | null };
  authorized_by: { id: string | null; name: string | null };
  payments:      RefundPaymentSlice[];
}

export interface CancelledProductRow {
  product_id: string;
  name:       string;
  line_count: number;
  value:      number;
  top_reason: string | null;
  top_cashier: { id: string | null; name: string | null; count: number };
}

export interface RefundsReportSummary {
  refunded:         number;
  refunded_prev:    number;
  refund_count:     number;
  void_count:       number;
  void_amount:      number;
  partial_count:    number;
  partial_amount:   number;
  tax_refunded:     number;
  gross_sales:      number;
  gross_sales_prev: number;
  cancelled:        { lines: number; value: number };
}

export interface RefundsReportData {
  period:               { start: string; end: string };
  period_prev:          { start: string; end: string };
  summary:              RefundsReportSummary;
  events:               RefundEvent[];
  cancelled_by_product: CancelledProductRow[];
}

export interface UseRefundsReportParams {
  start: string;
  end:   string;
}

const FAMILIES: readonly RefundReasonFamily[] =
  ['input_error', 'quality', 'duplicate', 'customer_change', 'other'];

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function toPeriod(v: unknown): { start: string; end: string } {
  const o = (v ?? {}) as Record<string, unknown>;
  return { start: toStr(o.start), end: toStr(o.end) };
}

function toActor(v: unknown): { id: string | null; name: string | null } {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    id:   o.id   != null ? toStr(o.id)   : null,
    name: o.name != null ? toStr(o.name) : null,
  };
}

function toFamily(v: unknown): RefundReasonFamily {
  return FAMILIES.includes(v as RefundReasonFamily) ? (v as RefundReasonFamily) : 'other';
}

export function useRefundsReport(params: UseRefundsReportParams) {
  const { start, end } = params;
  return useQuery<RefundsReportData, Error>({
    queryKey: ['refunds-report', start, end],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_refunds_report_v1', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) throw error as Error;

      const r         = (data ?? {}) as Record<string, unknown>;
      const summary   = (r.summary ?? {}) as Record<string, unknown>;
      const cancelled = (summary.cancelled ?? {}) as Record<string, unknown>;
      const events    = Array.isArray(r.events) ? (r.events as unknown[]) : [];
      const clRows    = Array.isArray(r.cancelled_by_product)
        ? (r.cancelled_by_product as unknown[]) : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        summary: {
          refunded:         toNum(summary.refunded),
          refunded_prev:    toNum(summary.refunded_prev),
          refund_count:     toNum(summary.refund_count),
          void_count:       toNum(summary.void_count),
          void_amount:      toNum(summary.void_amount),
          partial_count:    toNum(summary.partial_count),
          partial_amount:   toNum(summary.partial_amount),
          tax_refunded:     toNum(summary.tax_refunded),
          gross_sales:      toNum(summary.gross_sales),
          gross_sales_prev: toNum(summary.gross_sales_prev),
          cancelled: { lines: toNum(cancelled.lines), value: toNum(cancelled.value) },
        },
        events: events.map((e) => {
          const o = (e ?? {}) as Record<string, unknown>;
          const payments = Array.isArray(o.payments) ? (o.payments as unknown[]) : [];
          return {
            id:            toStr(o.id),
            refund_number: toStr(o.refund_number),
            order_id:      toStr(o.order_id),
            order_number:  toStr(o.order_number),
            created_at:    toStr(o.created_at),
            business_date: toStr(o.business_date),
            is_full_void:  o.is_full_void === true,
            reason:        toStr(o.reason),
            reason_family: toFamily(o.reason_family),
            tax_refunded:  toNum(o.tax_refunded),
            total:         toNum(o.total),
            refunded_by:   toActor(o.refunded_by),
            authorized_by: toActor(o.authorized_by),
            payments: payments.map((p) => {
              const pp = (p ?? {}) as Record<string, unknown>;
              return { method: toStr(pp.method), amount: toNum(pp.amount) };
            }),
          };
        }),
        cancelled_by_product: clRows.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          const cashier = (o.top_cashier ?? {}) as Record<string, unknown>;
          return {
            product_id: toStr(o.product_id),
            name:       toStr(o.name),
            line_count: toNum(o.line_count),
            value:      toNum(o.value),
            top_reason: o.top_reason != null ? toStr(o.top_reason) : null,
            top_cashier: {
              id:    cashier.id   != null ? toStr(cashier.id)   : null,
              name:  cashier.name != null ? toStr(cashier.name) : null,
              count: toNum(cashier.count),
            },
          };
        }),
      } satisfies RefundsReportData;
    },
  });
}
