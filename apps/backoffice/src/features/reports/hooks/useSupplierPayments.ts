// apps/backoffice/src/features/reports/hooks/useSupplierPayments.ts
//
// Query hook pour `get_supplier_payments_v1` — les règlements fournisseurs.
// DEUX NATURES DE CHIFFRE dans une même réponse : le DÉCAISSÉ est périodique
// (fenêtre + comparaison), l'ENCOURS est un snapshot (PO received, hors
// imports historiques, solde = total − Σ règlements) — la page ne doit
// jamais leur donner le même traitement (delta sur l'un, date sur l'autre).

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface SupplierPaymentRow {
  payment_id:    string;
  po_id:         string;
  po_number:     string;
  supplier_name: string;
  amount:        number;
  method:        string;
  reference:     string | null;
  paid_on:       string;
}

export interface SupplierPaymentsDayRow {
  date:   string;
  amount: number;
  count:  number;
}

export interface SupplierOutstandingRow {
  supplier_id:   string;
  supplier_name: string;
  outstanding:   number;
  po_count:      number;
  oldest_days:   number;
}

export interface OpenPoRow {
  po_id:         string;
  po_number:     string;
  supplier_id:   string;
  supplier_name: string;
  received_on:   string | null;
  total:         number;
  settled:       number;
  outstanding:   number;
  age_days:      number;
}

export interface SupplierPaymentsSummary {
  paid_total:          number;
  paid_total_prev:     number;
  payments_count:      number;
  outstanding_total:   number;
  open_po_count:       number;
  supplier_count:      number;
  oldest_open_days:    number;
  avg_settlement_days: number | null;
}

export interface SupplierPaymentsData {
  period:      { start: string; end: string };
  period_prev: { start: string; end: string };
  as_of:       string;
  summary:     SupplierPaymentsSummary;
  by_day:      SupplierPaymentsDayRow[];
  by_supplier_outstanding: SupplierOutstandingRow[];
  open_pos:    OpenPoRow[];
  payments:    SupplierPaymentRow[];
}

export interface UseSupplierPaymentsParams {
  start: string;
  end:   string;
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

export function useSupplierPayments(params: UseSupplierPaymentsParams) {
  const { start, end } = params;
  return useQuery<SupplierPaymentsData, Error>({
    queryKey: ['supplier-payments', start, end],
    staleTime: 60_000,
    enabled: Boolean(start && end),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_supplier_payments_v1', {
        p_start_date: start,
        p_end_date:   end,
      });
      if (error) throw error as Error;

      const r        = (data ?? {}) as Record<string, unknown>;
      const summary  = (r.summary ?? {}) as Record<string, unknown>;
      const days     = Array.isArray(r.by_day) ? (r.by_day as unknown[]) : [];
      const supp     = Array.isArray(r.by_supplier_outstanding) ? (r.by_supplier_outstanding as unknown[]) : [];
      const openPos  = Array.isArray(r.open_pos) ? (r.open_pos as unknown[]) : [];
      const payments = Array.isArray(r.payments) ? (r.payments as unknown[]) : [];

      return {
        period:      toPeriod(r.period),
        period_prev: toPeriod(r.period_prev),
        as_of:       toStr(r.as_of),
        summary: {
          paid_total:          toNum(summary.paid_total),
          paid_total_prev:     toNum(summary.paid_total_prev),
          payments_count:      toNum(summary.payments_count),
          outstanding_total:   toNum(summary.outstanding_total),
          open_po_count:       toNum(summary.open_po_count),
          supplier_count:      toNum(summary.supplier_count),
          oldest_open_days:    toNum(summary.oldest_open_days),
          avg_settlement_days: toNumOrNull(summary.avg_settlement_days),
        },
        by_day: days.map((d) => {
          const o = (d ?? {}) as Record<string, unknown>;
          return { date: toStr(o.date), amount: toNum(o.amount), count: toNum(o.count) };
        }),
        by_supplier_outstanding: supp.map((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return {
            supplier_id:   toStr(o.supplier_id),
            supplier_name: toStr(o.supplier_name),
            outstanding:   toNum(o.outstanding),
            po_count:      toNum(o.po_count),
            oldest_days:   toNum(o.oldest_days),
          };
        }),
        open_pos: openPos.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            po_id:         toStr(o.po_id),
            po_number:     toStr(o.po_number),
            supplier_id:   toStr(o.supplier_id),
            supplier_name: toStr(o.supplier_name),
            received_on:   o.received_on != null ? toStr(o.received_on) : null,
            total:         toNum(o.total),
            settled:       toNum(o.settled),
            outstanding:   toNum(o.outstanding),
            age_days:      toNum(o.age_days),
          };
        }),
        payments: payments.map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          return {
            payment_id:    toStr(o.payment_id),
            po_id:         toStr(o.po_id),
            po_number:     toStr(o.po_number),
            supplier_name: toStr(o.supplier_name),
            amount:        toNum(o.amount),
            method:        toStr(o.method),
            reference:     o.reference != null ? toStr(o.reference) : null,
            paid_on:       toStr(o.paid_on),
          };
        }),
      } satisfies SupplierPaymentsData;
    },
  });
}
