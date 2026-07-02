// apps/pos/src/features/settings/hooks/useTaxRate.ts
//
// S51 — server-authoritative POS tax rate.
//
// Reads `business_config.tax_rate` — the SAME value the money-path RPC
// `complete_order_with_payment_v16` applies server-side — so the PRE-payment
// pricing surfaces (cart footer, payment terminal estimate, printed bill,
// customer-display mirror) estimate tax at the real rate instead of the
// hardcoded `DEFAULT_TAX_RATE`. POST-payment surfaces consume the server-returned
// `tax_amount` / `total` directly and do not need this hook.
//
// Degrades to `DEFAULT_TAX_RATE` (0.10) while the config query is loading or if
// the row is unreadable under the POS JWT — a config read must never block an
// encaissement. Mirrors the direct-read pattern of `useShiftCloseSummary`.

import { useQuery } from '@tanstack/react-query';
import { DEFAULT_TAX_RATE } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

const QUERY_KEY = ['business-config', 'tax-rate'] as const;

/**
 * Live POS tax rate as a fraction (e.g. `0.10`). Returns `DEFAULT_TAX_RATE`
 * while loading or on error so dependent surfaces always have a usable rate.
 */
export function useTaxRate(): number {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    // The rate changes rarely; a long stale window avoids re-reading on every
    // cart mutation while still picking up a change within the session.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('tax_rate')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const rate = Number(data?.tax_rate);
      return Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_TAX_RATE;
    },
  });
  return data ?? DEFAULT_TAX_RATE;
}
