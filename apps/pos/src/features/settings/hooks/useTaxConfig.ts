// apps/pos/src/features/settings/hooks/useTaxConfig.ts
//
// S51 (useTaxRate) → Lot 6b (useTaxConfig) — server-authoritative POS tax
// config: rate AND mode.
//
// Reads `business_config.tax_rate` + `tax_inclusive` — the SAME pair the
// money-path helper `_pb1_split_v1` applies server-side — so the PRE-payment
// pricing surfaces (cart footer, payment terminal estimate, printed bill,
// customer-display mirror, tablet preview) estimate the PB1 split exactly as
// the server will charge it. POST-payment surfaces consume the server-returned
// `tax_amount` / `total` directly and do not need this hook.
//
// Degrades to `DEFAULT_TAX_RATE` (0.10) / inclusive while the config query is
// loading or if the row is unreadable under the POS JWT — a config read must
// never block an encaissement. Mirrors the direct-read pattern of
// `useShiftCloseSummary`.

import { useQuery } from '@tanstack/react-query';
import { DEFAULT_TAX_RATE } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

const QUERY_KEY = ['business-config', 'tax-config'] as const;

export interface TaxConfig {
  /** Live PB1 rate as a fraction (e.g. `0.10`). */
  taxRate: number;
  /** Global tax mode (`business_config.tax_inclusive`) — true: prices carry
   *  the PB1; false: the PB1 is added on top (mirror of `_pb1_split_v1`). */
  taxInclusive: boolean;
}

const FALLBACK: TaxConfig = { taxRate: DEFAULT_TAX_RATE, taxInclusive: true };

/**
 * Live POS tax config. Returns `{ taxRate: 0.10, taxInclusive: true }` while
 * loading or on error so dependent surfaces always have a usable split.
 */
export function useTaxConfig(): TaxConfig {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    // The config changes rarely; a long stale window avoids re-reading on every
    // cart mutation while still picking up a change within the session.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TaxConfig> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('tax_rate, tax_inclusive')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const rate = Number(data?.tax_rate);
      return {
        taxRate: Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_TAX_RATE,
        taxInclusive: typeof data?.tax_inclusive === 'boolean' ? data.tax_inclusive : true,
      };
    },
  });
  return data ?? FALLBACK;
}
