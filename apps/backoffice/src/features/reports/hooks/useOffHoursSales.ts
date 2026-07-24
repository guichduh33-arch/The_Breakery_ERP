// apps/backoffice/src/features/reports/hooks/useOffHoursSales.ts
// ADR-006 déc. 9 (business hours) — paiements encaissés hors du créneau
// d'ouverture du jour (get_off_hours_sales_v1, gate reports.audit.read).
// Jour fermé (null) = tout marqué ; jour absent de la config = jamais marqué.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface OffHoursSaleRow {
  order_id:     string;
  order_number: string;
  method:       string;
  amount:       number;
  paid_at:      string;
  local_time:   string;
  day_key:      string;
  window_open:  string | null;
  window_close: string | null;
  cashier:      string | null;
}

export interface OffHoursSalesData {
  rows:         OffHoursSaleRow[];
  paymentCount: number;
  orderCount:   number;
  totalAmount:  number;
}

export interface UseOffHoursSalesParams {
  start: string;
  end:   string;
}

export function useOffHoursSales(params: UseOffHoursSalesParams) {
  return useQuery<OffHoursSalesData, Error>({
    queryKey: ['reports', 'off_hours_sales', params.start, params.end],
    queryFn:  async () => {
      const { data, error } = await supabase.rpc('get_off_hours_sales_v1', {
        p_date_start: params.start,
        p_date_end:   params.end,
      });
      if (error) throw error as Error;
      // RPC returns { summary: { payment_count, order_count, total_amount }, rows: [...] }.
      const raw     = (data ?? {}) as Record<string, unknown>;
      const summary = (raw.summary ?? {}) as Record<string, unknown>;
      return {
        rows:         Array.isArray(raw.rows) ? (raw.rows as OffHoursSaleRow[]) : [],
        paymentCount: Number(summary.payment_count ?? 0),
        orderCount:   Number(summary.order_count ?? 0),
        totalAmount:  Number(summary.total_amount ?? 0),
      } satisfies OffHoursSalesData;
    },
    enabled: Boolean(params.start && params.end),
  });
}
