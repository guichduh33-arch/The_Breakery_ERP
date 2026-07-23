// apps/pos/src/features/shift/hooks/useShiftCloseSummary.ts
//
// POS audit 2026-06-12, lot 3 — preview data for CloseShiftModal.
// Mirrors the close_shift_v2 formula (20260606000015):
//   expected = opening_cash + cash_sales + cash_in_total - cash_out_total
//   cash_sales = SUM(order_payments.amount) for paid orders of the session
//                with method = 'cash'
// The server recomputes everything at close time — this hook only feeds the
// on-screen preview, so a small drift (e.g. a sale landing mid-count) is
// harmless: the persisted variance comes from the RPC.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Fallbacks when business_config is unreadable under the POS JWT. */
export const DEFAULT_VARIANCE_THRESHOLD_ABS = 50_000;
export const DEFAULT_VARIANCE_THRESHOLD_PCT = 0.005;
// S66 (12 D2.1) — manager-PIN thresholds (server defaults in close_shift_v5).
export const DEFAULT_VARIANCE_PIN_THRESHOLD_ABS = 200_000;
export const DEFAULT_VARIANCE_PIN_THRESHOLD_PCT = 0.02;

export interface ShiftCloseSummary {
  expectedCash: number;
  thresholdAbs: number;
  thresholdPct: number;
  pinThresholdAbs: number;
  pinThresholdPct: number;
}

export function useShiftCloseSummary(sessionId: string | null) {
  return useQuery({
    queryKey: ['shift-close-summary', sessionId],
    enabled: !!sessionId,
    staleTime: 0,
    queryFn: async (): Promise<ShiftCloseSummary> => {
      const { data: session, error: sessionErr } = await supabase
        .from('pos_sessions')
        .select('opening_cash, cash_in_total, cash_out_total')
        .eq('id', sessionId!)
        .single();
      if (sessionErr) throw new Error(sessionErr.message);

      const { data: payments, error: payErr } = await supabase
        .from('order_payments')
        .select('amount, orders!inner(session_id, status)')
        .eq('orders.session_id', sessionId!)
        // ADR-009 déc. 4 : miroir de close_shift_v8 — une commande servie passe
        // paid→completed, ses paiements comptent toujours dans le tiroir.
        .in('orders.status', ['paid', 'completed'])
        .eq('method', 'cash');
      if (payErr) throw new Error(payErr.message);
      const cashSales = (payments ?? []).reduce(
        (sum, p) => sum + Number(p.amount ?? 0),
        0,
      );

      // Thresholds are display-only — fall back to defaults if the config row
      // is unreadable rather than blocking the close flow.
      let thresholdAbs = DEFAULT_VARIANCE_THRESHOLD_ABS;
      let thresholdPct = DEFAULT_VARIANCE_THRESHOLD_PCT;
      let pinThresholdAbs = DEFAULT_VARIANCE_PIN_THRESHOLD_ABS;
      let pinThresholdPct = DEFAULT_VARIANCE_PIN_THRESHOLD_PCT;
      const { data: cfg } = await supabase
        .from('business_config')
        .select('shift_variance_threshold_abs, shift_variance_threshold_pct, shift_variance_pin_threshold_abs, shift_variance_pin_threshold_pct')
        .limit(1)
        .maybeSingle();
      if (cfg) {
        thresholdAbs = Number(cfg.shift_variance_threshold_abs ?? thresholdAbs);
        thresholdPct = Number(cfg.shift_variance_threshold_pct ?? thresholdPct);
        pinThresholdAbs = Number(cfg.shift_variance_pin_threshold_abs ?? pinThresholdAbs);
        pinThresholdPct = Number(cfg.shift_variance_pin_threshold_pct ?? pinThresholdPct);
      }

      const expectedCash =
        Number(session.opening_cash ?? 0)
        + cashSales
        + Number(session.cash_in_total ?? 0)
        - Number(session.cash_out_total ?? 0);

      return { expectedCash, thresholdAbs, thresholdPct, pinThresholdAbs, pinThresholdPct };
    },
  });
}
