// apps/backoffice/src/features/reports/hooks/useArAging.ts
//
// Query hook pour `get_ar_aging_v1` — l'AR aging B2B. SNAPSHOT COURANT (pas de
// période) : une facture est une créance tant qu'elle est b2b_pending, son
// encours = total − Σ allocations. Les buckets se calculent par jours de
// RETARD après échéance (émission + terms client, défaut 30 j). La page
// recalcule le % échu et repère un drift entre l'encours recalculé et
// `balance_cached` (customers.b2b_current_balance) — jamais masqué.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type ArBucket =
  | 'current' | 'late_1_30' | 'late_31_60' | 'late_61_90' | 'late_90_plus';

export interface ArAgingBucketRow {
  bucket:        ArBucket;
  amount:        number;
  invoice_count: number;
}

export interface ArAgingCustomerRow {
  customer_id:       string;
  customer_name:     string;
  company:           string | null;
  terms_days:        number;
  credit_limit:      number | null;
  balance_cached:    number;
  current:           number;
  late_1_30:         number;
  late_31_60:        number;
  late_61_90:        number;
  late_90_plus:      number;
  total_outstanding: number;
  max_days_late:     number;
}

export interface ArAgingInvoiceRow {
  invoice_id:     string;
  order_number:   string;
  invoice_number: string | null;
  customer_id:    string;
  customer_name:  string;
  issued_on:      string;
  due_date:       string;
  days_late:      number;
  bucket:         ArBucket;
  total:          number;
  settled:        number;
  outstanding:    number;
}

export interface ArAgingSummary {
  total_outstanding:     number;
  overdue_total:         number;
  invoice_count:         number;
  overdue_invoice_count: number;
  customer_count:        number;
  oldest_days_late:      number;
  oldest_customer:       string | null;
  dso_90d:               number | null;
}

export interface ArAgingData {
  as_of:              string;
  timezone:           string;
  terms_default_days: number;
  summary:            ArAgingSummary;
  by_bucket:          ArAgingBucketRow[];
  by_customer:        ArAgingCustomerRow[];
  invoices:           ArAgingInvoiceRow[];
}

const BUCKETS: ArBucket[] = [
  'current', 'late_1_30', 'late_31_60', 'late_61_90', 'late_90_plus',
];

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

function toBucket(v: unknown): ArBucket {
  return BUCKETS.includes(v as ArBucket) ? (v as ArBucket) : 'current';
}

export function useArAging() {
  return useQuery<ArAgingData, Error>({
    queryKey: ['ar-aging'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_ar_aging_v1');
      if (error) throw error as Error;

      const r         = (data ?? {}) as Record<string, unknown>;
      const summary   = (r.summary ?? {}) as Record<string, unknown>;
      const buckets   = Array.isArray(r.by_bucket)   ? (r.by_bucket as unknown[])   : [];
      const customers = Array.isArray(r.by_customer) ? (r.by_customer as unknown[]) : [];
      const invoices  = Array.isArray(r.invoices)    ? (r.invoices as unknown[])    : [];

      return {
        as_of:              toStr(r.as_of),
        timezone:           toStr(r.timezone),
        terms_default_days: toNum(r.terms_default_days),
        summary: {
          total_outstanding:     toNum(summary.total_outstanding),
          overdue_total:         toNum(summary.overdue_total),
          invoice_count:         toNum(summary.invoice_count),
          overdue_invoice_count: toNum(summary.overdue_invoice_count),
          customer_count:        toNum(summary.customer_count),
          oldest_days_late:      toNum(summary.oldest_days_late),
          oldest_customer:       summary.oldest_customer != null ? toStr(summary.oldest_customer) : null,
          dso_90d:               toNumOrNull(summary.dso_90d),
        },
        by_bucket: buckets.map((b) => {
          const o = (b ?? {}) as Record<string, unknown>;
          return {
            bucket:        toBucket(o.bucket),
            amount:        toNum(o.amount),
            invoice_count: toNum(o.invoice_count),
          };
        }),
        by_customer: customers.map((c) => {
          const o = (c ?? {}) as Record<string, unknown>;
          return {
            customer_id:       toStr(o.customer_id),
            customer_name:     toStr(o.customer_name),
            company:           o.company != null ? toStr(o.company) : null,
            terms_days:        toNum(o.terms_days),
            credit_limit:      toNumOrNull(o.credit_limit),
            balance_cached:    toNum(o.balance_cached),
            current:           toNum(o.current),
            late_1_30:         toNum(o.late_1_30),
            late_31_60:        toNum(o.late_31_60),
            late_61_90:        toNum(o.late_61_90),
            late_90_plus:      toNum(o.late_90_plus),
            total_outstanding: toNum(o.total_outstanding),
            max_days_late:     toNum(o.max_days_late),
          };
        }),
        invoices: invoices.map((i) => {
          const o = (i ?? {}) as Record<string, unknown>;
          return {
            invoice_id:     toStr(o.invoice_id),
            order_number:   toStr(o.order_number),
            invoice_number: o.invoice_number != null ? toStr(o.invoice_number) : null,
            customer_id:    toStr(o.customer_id),
            customer_name:  toStr(o.customer_name),
            issued_on:      toStr(o.issued_on),
            due_date:       toStr(o.due_date),
            days_late:      toNum(o.days_late),
            bucket:         toBucket(o.bucket),
            total:          toNum(o.total),
            settled:        toNum(o.settled),
            outstanding:    toNum(o.outstanding),
          };
        }),
      } satisfies ArAgingData;
    },
  });
}
