// packages/domain/src/orders/taxRate.ts
//
// Centralised tax-rate constant for the POS (D5 decision — Session 37 POS-05).
// Business logic reads `business_config.tax_rate` at runtime — that runtime hook
// is deferred to S38. For now every POS site imports this single constant so
// there is one place to update when the rate changes or the hook is wired.
//
// IMPORTANT: this module is IO-free (no fetch, no Supabase, no React) — it lives
// in @breakery/domain which must stay testable without a running server.

import { roundIdr } from '@breakery/utils';

/**
 * The default tax rate applied across all POS totals (10 % = PB1 + VAT fold).
 * Runtime surfaces read the live rate via the POS `useTaxConfig()` hook.
 */
export const DEFAULT_TAX_RATE = 0.10;

export interface Pb1Split {
  tax_amount: number;
  /** Amount the customer pays: base (inclusive) or base + tax (exclusive). */
  total: number;
}

/**
 * Client-side mirror of `_pb1_split_v1`, the sole server-side carrier of the
 * PB1 formula (Lot 6a/6b — global `business_config.tax_inclusive` setting).
 * `base` is the post-discount/promo amount the split applies to.
 *   inclusive — tax = round_idr(base * r / (1 + r)), total = base
 *   exclusive — tax = round_idr(base * r),           total = base + tax
 * Display-only: the server RPC remains the pricing authority.
 */
export function splitPb1(base: number, taxRate: number, taxInclusive: boolean = true): Pb1Split {
  if (taxInclusive) {
    return { tax_amount: roundIdr((base * taxRate) / (1 + taxRate)), total: base };
  }
  const tax_amount = roundIdr(base * taxRate);
  return { tax_amount, total: base + tax_amount };
}
